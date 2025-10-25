const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const cookieParser = require('cookie-parser');
const path = require('path');
const fs = require('fs');
const http = require('http');
const prisma = require('./config/db');
const { initSocket, getOnlineUsers } = require('./utils/socket');

const app = express();

// ===== Env Vars =====
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:4200';
const PORT = process.env.PORT || 4000;
const AUTH_STRATEGY = process.env.AUTH_STRATEGY || 'dev';

// ===== Middleware =====
app.use(helmet({
    crossOriginResourcePolicy: false, // disable CORP so we can set manually
}));

if (AUTH_STRATEGY === 'dev') {
    app.use(cors());
} else {
    app.use(cors({
        origin: FRONTEND_URL,
        credentials: true,
    }));
}

app.use(morgan('dev'));
app.use(express.json());
app.use(cookieParser());

const uploadPath = path.resolve(process.cwd(), 'uploads');

if (!fs.existsSync(uploadPath)) fs.mkdirSync(uploadPath, { recursive: true });

app.use('/uploads', (req, res, next) => {
    // Allow cross-origin images to be loaded
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin'); // <-- this is key
    next();
}, express.static(uploadPath));

// ===== Routes =====
const authRoutes = require('./routes/auth.routes');
const otpRoutes = require('./routes/otp.routes');
const adminRoutes = require('./routes/admin.routes');
const doctorRoutes = require('./routes/doctor.routes');
const patientRoutes = require('./routes/patient.routes');
const sharedRoutes = require('./routes/shared.routes');
const paymentRoutes = require('./routes/payment.routes');
const notificationRoutes = require('./routes/notifications.routes');
const chatRoutes = require('./routes/chat.routes');

app.use('/api/auth', authRoutes);
app.use('/api/otp', otpRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/doctor', doctorRoutes);
app.use('/api/patient', patientRoutes);
app.use('/api/payment', paymentRoutes);
app.use('/api/', sharedRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/chat', chatRoutes);

// ===== Socket.io =====
const server = http.createServer(app);
const io = initSocket(server);

// ===== Start server =====
server.listen(PORT, () =>
    console.log(
        `🚀 Server running on port ${PORT} | Mode: ${AUTH_STRATEGY.toUpperCase()} | Frontend: ${FRONTEND_URL}`
    )
);
