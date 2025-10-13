// socket.js
const { Server } = require('socket.io');
const prisma = require("../config/db");

let io;
const onlineUsers = new Map();

function initSocket(server) {
    io = new Server(server, { cors: { origin: '*' } });
    io.on('connection', (socket) => {
        socket.activeConversation = null;

        socket.on('join', (userId) => {
            onlineUsers.set(Number(userId), socket.id);
            socket.join(String(userId));
        });

        socket.on('chatFocused', ({ conversationId }) => {
            socket.activeConversation = conversationId;
        });

        socket.on('chatBlurred', () => {
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
