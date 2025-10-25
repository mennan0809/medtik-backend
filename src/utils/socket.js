const { Server } = require('socket.io');
const prisma = require("../config/db");
const cors = require("cors");
const FRONTEND_URL = process.env.FRONTEND_URL || "http://localhost:4200";

let io;
const onlineUsers = new Map();

function initSocket(server) {
    io = new Server(server, {
        cors: {
            origin: FRONTEND_URL,
            credentials: true,
        }
    });

    io.on('connection', (socket) => {
        console.log(`🔌 New socket connected: ${socket.id}`);
        socket.activeConversation = null;
        const role = socket.handshake.auth.role;
        const userId = socket.handshake.auth.userId;

        if (role === "ADMIN") {
            socket.join("admins");
            console.log(`🧑‍💼 Admin socket joined "admins" room`);
        }

        if (userId) {
            // add to onlineUsers map
            const sockets = onlineUsers.get(userId) || new Set();
            sockets.add(socket.id);
            onlineUsers.set(userId, sockets);
            socket.join(String(userId));

            console.log(`👤 User ${userId} connected (${socket.id})`);
            console.log(`🧠 Current onlineUsers map:`,
                Object.fromEntries([...onlineUsers].map(([k, v]) => [k, [...v]]))
            );
            io.emit('user:online', { userId });
            socket.emit('online:all', [...onlineUsers.keys()]);
        } else {
            console.warn(`⚠️ No userId in handshake auth`);
        }

        socket.on('join', (userId) => {
            userId = Number(userId);
            const sockets = onlineUsers.get(userId) || new Set();
            sockets.add(socket.id);
            onlineUsers.set(userId, sockets);
            socket.join(String(userId));
            io.emit('user:online', { userId });
            socket.emit('online:all', [...onlineUsers.keys()]);

            console.log(`👤 User ${userId} joined. Total online users: ${onlineUsers.size}`);
        });

        socket.on('notification:new', (data) => {
            console.log('📩 New notification received:', data);
        });

        socket.on('chatFocused', ({ conversationId }) => {
            console.log("FOCUSED");
            socket.activeConversation = conversationId;
            console.log(`💬 Socket ${socket.id} focused on conversation ${conversationId}`);
        });

        socket.on('chatBlurred', () => {
            console.log(`💤 Socket ${socket.id} blurred conversation ${socket.activeConversation}`);
            socket.activeConversation = null;
        });

        socket.on('markSeen', async ({ conversationId, userId }) => {
            try {
                const result = await prisma.message.updateMany({
                    where: {
                        conversationId,
                        seen: false,
                        NOT: { senderId: userId },
                    },
                    data: { seen: true },
                });
                console.log(`✅ Messages marked seen for user ${userId} in conversation ${conversationId}: ${result.count}`);
            } catch (err) {
                console.error(`❌ Error marking messages as seen for user ${userId}:`, err.message);
            }
        });


        socket.on('disconnect', (reason) => {
            console.log(`❌ Socket disconnected: ${socket.id}`);
            console.log(`ℹ️ Disconnect reason: ${reason}`); // <-- log reason

            for (let [uid, sockets] of onlineUsers.entries()) {
                sockets.delete(socket.id);
                if (sockets.size === 0) {
                    onlineUsers.delete(uid);
                    io.emit('user:offline', { userId: uid });
                }
            }

        });
    });

    console.log('⚡ Socket.IO server initialized');

    return io;
}

function getIO() {
    if (!io) throw new Error('Socket.io not initialized!');
    return io;
}

function getOnlineUsers() {
    console.log("HELLLOOO", [...onlineUsers.entries()]);
    return onlineUsers;
}

module.exports = { initSocket, getIO, getOnlineUsers };
