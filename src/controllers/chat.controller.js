const prisma = require('../config/db');

// ===== Helper to find or create conversation =====
const getOrCreateConversation = async (sId, rId) => {
    let conversation = await prisma.conversation.findFirst({
        where: {
            participants: { every: { id: { in: [sId, rId] } } },
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

// ===== Send Message =====
exports.sendMessage = (io, onlineUsers) => async (req, res) => {
    try {
        const senderId = req.user.id;
        const { receiverId, content, type } = req.body;

        const sId = Number(senderId);
        const rId = Number(receiverId);

        const conversation = await getOrCreateConversation(sId, rId);

        const message = await prisma.message.create({
            data: {
                conversationId: conversation.id,
                senderId: sId,
                content,
                type: type || 'TEXT',
            },
            include: { sender: { select: { id: true, fullName: true } } },
        });

        const receiverSocketId = onlineUsers.get(rId);
        if (receiverSocketId) {
            const receiverSocket = io.sockets.sockets.get(receiverSocketId);

            if (receiverSocket && receiverSocket.activeConversation === conversation.id) {
                // 👀 Receiver is actively viewing the chat
                await prisma.message.update({
                    where: { id: message.id },
                    data: { seen: true },
                });
                io.to(receiverSocketId).emit('receiveMessage', message);
            } else {
                // 🔔 Receiver NOT in chat
                io.to(receiverSocketId).emit('receiveMessage', message);
                io.to(receiverSocketId).emit('notification', {
                    type: 'MESSAGE',
                    title: 'New Message',
                    message: `${message.sender.fullName} sent you a message.`,
                    redirectUrl: `/chat/${sId}`,
                });

                await prisma.notification.create({
                    data: {
                        userId: rId,
                        type: 'MESSAGE',
                        title: 'New Message',
                        message: `${message.sender.fullName} sent you a message.`,
                        redirectUrl: `/chat/${sId}`,
                        metadata: { senderId: sId, messageId: message.id },
                    },
                });
            }
        } else {
            // 💾 Receiver offline → just save notification
            await prisma.notification.create({
                data: {
                    userId: rId,
                    type: 'MESSAGE',
                    title: 'New Message',
                    message: `${message.sender.fullName} sent you a message.`,
                    redirectUrl: `/chat/${sId}`,
                    metadata: { senderId: sId, messageId: message.id },
                },
            });
        }

        res.json({ success: true, message });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to send message' });
    }
};

// ===== Get History =====
exports.getHistory = async (req, res) => {
    try {
        const userId = req.user.id;
        const otherId = Number(req.params.otherId);

        const conversation = await prisma.conversation.findFirst({
            where: {
                participants: { every: { id: { in: [userId, otherId] } } },
            },
            include: { messages: { include: { sender: true } } },
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
        const userId = req.user.id;

        const conversations = await prisma.conversation.findMany({
            where: {
                participants: { some: { id: userId } },
            },
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
                participants: others.map((p) => ({
                    id: p.id,
                    fullName: p.fullName,
                })),
                lastMessage: conv.messages[0] || null,
            };
        });

        res.json({ conversations: formatted });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to get conversations' });
    }
};
