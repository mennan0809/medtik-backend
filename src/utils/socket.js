// socket.js
const { Server } = require('socket.io');
const prisma = require("../config/db");

let io;
const onlineUsers = new Map();

function initSocket(server) {
    io = new Server(server, { cors: { origin: '*' } });
    io.on('connection', (socket) => {
        console.log('⚡ User connected:', socket.id);
        socket.activeConversation = null;

        socket.on('join', (userId) => {
            onlineUsers.set(Number(userId), socket.id);
            socket.join(String(userId));
            console.log(`👤 User ${userId} joined their room`);
        });

        socket.on('chatFocused', ({ conversationId }) => {
            socket.activeConversation = conversationId;
            console.log(`💬 Socket ${socket.id} focused on chat ${conversationId}`);
        });

        socket.on('chatBlurred', () => {
            console.log(`👁️ Socket ${socket.id} blurred chat ${socket.activeConversation}`);
            socket.activeConversation = null;
        });

        socket.on('markSeen', async ({ conversationId, userId }) => {
            await prisma.message.updateMany({
                where: { conversationId, receiverId: userId, seen: false },
                data: { seen: true },
            });
        });

        socket.on('disconnect', () => {
            for (let [uid, sid] of onlineUsers.entries()) {
                if (sid === socket.id) onlineUsers.delete(uid);
            }
            console.log('❌ User disconnected:', socket.id);
        });
    });

    return io;
}

function getIO() {
    if (!io) throw new Error('Socket.io not initialized!');
    return io;
}

function getOnlineUsers() {
    return onlineUsers;
}

module.exports = { initSocket, getIO, getOnlineUsers };
