const prisma = require('../config/db');
const { getOnlineUsers, getIO} = require('../utils/socket');
const { pushNotification } = require('../utils/notifications');

// ===== Helper: find or create a conversation between two users =====
const getOrCreateConversation = async (sId, rId) => {
    // Find conversation that has exactly these two participants (or more, if needed)
    let conversation = await prisma.conversation.findFirst({
        where: {
            AND: [
                { participants: { some: { id: sId } } },
                { participants: { some: { id: rId } } },
            ],
        },
        include: { participants: true, messages: { include: { sender: true } } },
    });

    if (!conversation) {
        conversation = await prisma.conversation.create({
            data: {
                participants: { connect: [{ id: sId }, { id: rId }] },
            },
            include: { participants: true, messages: { include: { sender: true } } },
        });
    }

    return conversation;
};

// ===== Helper: create notification =====
const createNotification = (userId, sender, messageId) => {
    return pushNotification({
        userId,
        type: 'MESSAGE',
        title: 'New Message',
        message: `${sender.fullName} sent you a message.`,
        redirectUrl: `/chat/${sender.id}`,
        metadata: { senderId: sender.id, messageId }
    });
};

// ===== Send Message (with Debug Logs) =====
exports.sendMessage = async (req, res) => {
    try {
        const senderId = Number(req.user.id);
        const { receiverId, content, type } = req.body;
        const rId = Number(receiverId);

        console.log('\n🚀 [sendMessage] Incoming message...');
        console.log('   🔹 Sender ID:', senderId);
        console.log('   🔹 Receiver ID:', rId);
        console.log('   🔹 Content:', content);
        console.log('   🔹 Type:', type);

        // =========================
        // 1️⃣ Get or create conversation
        // =========================
        const conversation = await getOrCreateConversation(senderId, rId);
        console.log('🗨️  Conversation:', conversation?.id);

        // =========================
        // 2️⃣ Create message
        // =========================
        const rawMessage = await prisma.message.create({
            data: {
                conversationId: conversation.id,
                senderId,
                content,
                type: type || 'TEXT',
            },
            include: {
                sender: { select: { id: true, fullName: true } },
            },
        });

        console.log('💾 Message created in DB:', {
            id: rawMessage.id,
            senderId: rawMessage.senderId,
            receiverId: rId,
            content: rawMessage.content,
            type: rawMessage.type,
        });

        // =========================
        // 3️⃣ Prepare message payload
        // =========================
        const message = {
            id: String(rawMessage.id),
            senderId,
            receiverId: rId,
            text: rawMessage.content,
            type: rawMessage.type,
            ts: rawMessage.createdAt,
            seen: false,
            sender: {
                id: rawMessage.sender.id,
                fullName: rawMessage.sender.fullName,
            },
        };

        const io = getIO();
        const onlineUsers = await getOnlineUsers(); // If async, keep await
        const receiverSockets = onlineUsers.get(rId); // Set<socketId>

        console.log('🧠 Online users map size:', onlineUsers.size);
        console.log('   🧩 Receiver sockets:', receiverSockets ? Array.from(receiverSockets) : '❌ None found');

        let seenMarked = false;

        // =========================
        // 4️⃣ Emit messages
        // =========================
        if (receiverSockets && receiverSockets.size > 0) {
            console.log('📡 Receiver online — sending messages...');
            for (const sid of receiverSockets) {
                const socket = io.sockets.sockets.get(sid);
                if (!socket) {
                    console.warn(`   ⚠️ Socket ${sid} not found (probably disconnected)`);
                    continue;
                }

                console.log(`   🔸 Sending to socket ${sid}`);
                console.log(`      ↪ activeConversation: ${socket.activeConversation}`);
                console.log(`      ↪ targetConversation: ${conversation.id}`);

                // Mark as seen if receiver is viewing same conversation
                if (socket.activeConversation === conversation.id && !seenMarked) {
                    console.log('   👀 Receiver is viewing this convo → marking as seen...');
                    await prisma.message.update({
                        where: { id: rawMessage.id },
                        data: { seen: true },
                    });
                    seenMarked = true;

                    io.to(socket.id).emit('messageAck', { messageId: rawMessage.id });
                    console.log('   ✅ Seen + messageAck emitted');
                }

                // Always deliver the message
                io.to(socket.id).emit('newMessage', message);
                console.log('   📤 Message emitted to', sid);
            }

            if (!seenMarked) {
                console.log('🔔 No socket in active convo → creating notification');
                await createNotification(rId, rawMessage.sender, rawMessage.id);
            }
        } else {
            // Receiver offline → create notification
            console.log('💤 Receiver is offline → creating notification...');
            await createNotification(rId, rawMessage.sender, rawMessage.id);
        }

        console.log('✅ [sendMessage] Completed successfully.\n');
        res.json({ success: true, message: rawMessage });
    } catch (err) {
        console.error('\n❌ [sendMessage] ERROR:', err);
        res.status(500).json({ error: 'Failed to send message' });
    }
};

// ===== Get History =====
exports.getHistory = async (req, res) => {
    try {
        const userId = Number(req.user.id);
        const otherId = Number(req.params.otherId);

        const conversation = await prisma.conversation.findFirst({
            where: {
                AND: [
                    { participants: { some: { id: userId } } },
                    { participants: { some: { id: otherId } } },
                ],
            },
            include: { messages: { include: { sender: true }, orderBy: { createdAt: 'asc' } } },
        });

        if (!conversation) return res.json({ messages: [] });

        res.json({ messages: conversation.messages });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to get history' });
    }
};

// ===== Get Conversations =====
exports.getConversations = async (req, res) => {
    try {
        const userId = Number(req.user.id);

        const conversations = await prisma.conversation.findMany({
            where: { participants: { some: { id: userId } } },
            include: {
                participants: true,
                messages: { orderBy: { createdAt: 'desc' }, take: 1 },
            },
            orderBy: { updatedAt: 'desc' },
        });

        const formatted = conversations.map((conv) => {
            const others = conv.participants.filter((p) => p.id !== userId);
            return {
                conversationId: conv.id,
                participants: others.map((p) => ({ id: p.id, fullName: p.fullName })),
                lastMessage: conv.messages[0] || null,
            };
        });

        res.json({ conversations: formatted });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to get conversations' });
    }
};
