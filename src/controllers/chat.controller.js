const prisma = require('../config/db');
const { getOnlineUsers, getIO} = require('../utils/socket');

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
const createNotification = (userId, sender, messageId) =>
    prisma.notification.create({
        data: {
            userId,
            type: 'MESSAGE',
            title: 'New Message',
            message: `${sender.fullName} sent you a message.`,
            redirectUrl: `/chat/${sender.id}`,
            metadata: { senderId: sender.id, messageId },
        },
    });

// ===== Send Message =====
exports.sendMessage = async (req, res) => {
    try {
        console.log("HELLOOO");

        const senderId = Number(req.user.id);
        const { receiverId, content, type } = req.body;
        const rId = Number(receiverId);
        console.log("IO"+getIO());
        const conversation = await getOrCreateConversation(senderId, rId);

        const rawMessage = await prisma.message.create({
            data: {
                conversationId: conversation.id,
                senderId,
                content,
                type: type || 'TEXT',
            },
            include: { sender: { select: { id: true, fullName: true } } },
        });

        const onlineUsers = await getOnlineUsers();
        const receiverSockets = onlineUsers.get(rId); // Set of socket IDs
        const message = {
            id: String(rawMessage.id),
            senderId: rawMessage.senderId,
            receiverId: rId,
            text: rawMessage.content,
            type: rawMessage.type,
            ts: rawMessage.createdAt,
            seen:false,
            sender: {
                id: rawMessage.sender.id,
                fullName: rawMessage.sender.fullName,
            },
        };

        // Inside sendMessage
        if (receiverSockets && receiverSockets.size > 0) {
            let seenMarked = false;
            for (const sid of receiverSockets) {
                const socket = getIO().sockets.sockets.get(sid);
                if (socket) {
                    // Mark as seen if user is actively viewing
                    if (socket.activeConversation === conversation.id && !seenMarked) {
                        await prisma.message.update({
                            where: { id: rawMessage.id },
                            data: { seen: true },
                        });
                        seenMarked = true;
                        getIO().to(sid).emit('newMessage', message);
                        continue;
                    }
                    getIO().to(sid).emit('newMessage', message);
                }
            }

            if (!seenMarked) {
                await createNotification(rId, rawMessage.sender, rawMessage.id);
            }
        }
        else {
            // Receiver offline → create notification
            await createNotification(rId, rawMessage.sender, rawMessage.id);
        }

        res.json({ success: true, message: rawMessage });
    } catch (err) {
        console.error(err);
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
