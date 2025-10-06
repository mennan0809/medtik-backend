const prisma = require("../config/db");

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

// Send a message (senderId comes from token)
exports.sendMessage = (io, onlineUsers) => async (req, res) => {
    try {
        const senderId = req.user.id; // <--- use authenticated user
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

        // Real-time push
        const receiverSocket = onlineUsers.get(rId);
        if (receiverSocket) io.to(receiverSocket).emit('receiveMessage', message);

        res.json({ success: true, message });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to send message' });
    }
};

// Get chat history
exports.getHistory = async (req, res) => {
    try {
        const userId = req.user.id; // <--- authenticated user
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

// Get all conversations for the authenticated user with last message
exports.getConversations = async (req, res) => {
    try {
        const userId = req.user.id; // sender from token

        // Find conversations where user is a participant
        const conversations = await prisma.conversation.findMany({
            where: {
                participants: { some: { id: userId } }
            },
            include: {
                participants: true,
                messages: {
                    orderBy: { createdAt: 'desc' },
                    take: 1 // only last message
                }
            },
            orderBy: {
                updatedAt: 'desc' // recent conversation first
            }
        });

        // Format data: show other user(s) and last message
        const formatted = conversations.map(conv => {
            const otherParticipants = conv.participants.filter(p => p.id !== userId);
            return {
                conversationId: conv.id,
                participants: otherParticipants.map(p => ({ id: p.id, fullName: p.fullName })),
                lastMessage: conv.messages[0] || null
            };
        });

        res.json({ conversations: formatted });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to get conversations' });
    }
};
