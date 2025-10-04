const prisma = require("../config/db");
const jwt = require("jsonwebtoken");
const JWT_SECRET = process.env.JWT_SECRET || "dev-secret";

// Get or create conversation between two users
async function getOrCreateConversation(user1Id, user2Id) {
    let conversation = await prisma.conversation.findFirst({
        where: {
            participants: {
                every: {
                    id: { in: [user1Id, user2Id] },
                },
            },
        },
        include: { participants: true, messages: true },
    });

    if (!conversation) {
        conversation = await prisma.conversation.create({
            data: {
                participants: {
                    connect: [{ id: user1Id }, { id: user2Id }],
                },
            },
            include: { participants: true, messages: true },
        });
    }

    return conversation;
}

// Send a message in a conversation
exports.sendMessage = async (req, res) => {
    try {
        const { senderId, receiverId, content, type } = req.body;

        // Get or create the conversation
        const conversation = await getOrCreateConversation(senderId, receiverId);

        // Create message
        const message = await prisma.message.create({
            data: {
                conversationId: conversation.id,
                senderId,
                content,
                type: type || "TEXT",
            },
        });

        res.json({ success: true, message });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Failed to send message" });
    }
};

// Get Chats of Logged in User
exports.getChats = async (req, res) => {
    try {
        const authHeader = req.headers.authorization;
        if (!authHeader?.startsWith("Bearer "))
            return res.status(401).json({ error: "No token provided" });

        const token = authHeader.split(" ")[1];
        const decoded = jwt.verify(token, JWT_SECRET);
        const userId = decoded.id;

        // Fetch conversations where the user is a participant
        const conversations = await prisma.conversation.findMany({
            where: {
                participants: {
                    some: {
                        id: userId,
                    },
                },
            },
            include: {
                participants: {
                    select: {
                        id: true,
                        fullName: true,
                        email: true,
                    },
                },
                messages: {
                    orderBy: { createdAt: "asc" }, // old → new
                    take: 50, // last 50 messages
                    include: {
                        sender: {
                            select: {
                                id: true,
                                fullName: true,
                            },
                        },
                    },
                },
            },
            orderBy: { updatedAt: "desc" }, // recent chats first
        });

        res.json({ conversations });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Server error" });
    }
};
