const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const cookieParser = require('cookie-parser');
const path = require('path');
const http = require('http');
const prisma = require('./config/db');
const { initSocket, getOnlineUsers } = require('./utils/socket');

const app = express();

// ===== Env Vars =====
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:4200';
const PORT = process.env.PORT || 4000;
const AUTH_STRATEGY = process.env.AUTH_STRATEGY || 'dev';

// ===== Middleware =====
app.use(helmet());

app.use(cors({
    origin: FRONTEND_URL,
    credentials: true
}));

app.use(morgan('dev'));
app.use(express.json());
app.use(cookieParser());
app.use('/uploads', express.static(path.join(__dirname, '..', 'uploads')));

// ===== Routes =====
const authRoutes = require('./routes/auth.routes');
const otpRoutes = require('./routes/otp.routes');
const adminRoutes = require('./routes/admin.routes');
const doctorRoutes = require('./routes/doctor.routes');
const patientRoutes = require('./routes/patient.routes');
const sharedRoutes = require('./routes/shared.routes');
const paymentRoutes = require('./routes/payment.routes');
const notificationRoutes = require('./routes/notifications.routes');

app.use('/api/auth', authRoutes);
app.use('/api/otp', otpRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/doctor', doctorRoutes);
app.use('/api/patient', patientRoutes);
app.use('/api/payment', paymentRoutes);
app.use('/api/', sharedRoutes);
app.use('/api/notifications', notificationRoutes);

// ===== Socket.io =====
const server = http.createServer(app);
const io = initSocket(server);
const onlineUsers = getOnlineUsers();
const chatRoutes = require('./routes/chat.routes')(io, onlineUsers);
app.use('/api/chat', chatRoutes);

// ===== Start server =====
server.listen(PORT, () =>
    console.log(
        `🚀 Server running on port ${PORT} | Mode: ${AUTH_STRATEGY.toUpperCase()} | Frontend: ${FRONTEND_URL}`
    )
);
