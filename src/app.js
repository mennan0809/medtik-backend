const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const cookieParser = require('cookie-parser');
const path = require("path");
const http = require("http");
const { Server } = require("socket.io");
const prisma = require("./config/db");
const app = express();

// ===== Middleware =====
app.use(helmet());
app.use(cors({ origin: '*', credentials: true }));
app.use(morgan('dev'));
app.use(express.json());
app.use(cookieParser());
app.use("/uploads", express.static(path.join(__dirname, "..", "uploads")));

// ===== Routes that DON'T need io =====
const authRoutes = require('./routes/auth.routes');
const otpRoutes = require('./routes/otp.routes');
const adminRoutes = require('./routes/admin.routes');
const doctorRoutes = require('./routes/doctor.routes');
const patientRoutes = require('./routes/patient.routes');
const sharedRoutes = require('./routes/shared.routes');
const paymentRoutes = require('./routes/payment.routes');

app.use('/api/auth', authRoutes);
app.use('/api/otp', otpRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/doctor', doctorRoutes);
app.use('/api/patient', patientRoutes);
app.use("/api/", sharedRoutes);
app.use("/api/payment", paymentRoutes);

// ===== Socket.IO setup =====
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });
const onlineUsers = new Map();

// Socket.IO: manage online users
io.on("connection", (socket) => {
    console.log("User connected:", socket.id);

    socket.on("join", (userId) => {
        onlineUsers.set(Number(userId), socket.id); // make sure userId is int
        socket.join(userId);
        console.log(`User ${userId} joined room`);
    });

    socket.on("markSeen", async ({ conversationId, userId }) => {
        await prisma.message.updateMany({
            where: { conversationId, receiverId: userId, seen: false },
            data: { seen: true },
        });
    });


    socket.on("disconnect", () => {
        for (let [uid, sid] of onlineUsers.entries()) {
            if (sid === socket.id) onlineUsers.delete(uid);
        }
        console.log("User disconnected:", socket.id);
    });
});

// ===== Routes that NEED io =====
const chatRoutes = require("./routes/chat.routes")(io, onlineUsers);
app.use("/api/chat", chatRoutes);

// ===== Start server =====
const PORT = process.env.PORT || 4000;
server.listen(PORT, () => console.log(`Server running on ${PORT}`));
