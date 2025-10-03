const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const cookieParser = require('cookie-parser');

// routes
const authRoutes = require('./routes/auth.routes');
const otpRoutes = require('./routes/otp.routes');
const adminRoutes = require('./routes/admin.routes');

const app = express();

// middleware
app.use(helmet());
app.use(cors({ origin: 'http://localhost:4200', credentials: true }));
app.use(morgan('dev'));
app.use(express.json());
app.use(cookieParser());

// routes
app.use('/api/auth', authRoutes);
app.use('/api/otp', otpRoutes);
app.use('/api/admin', adminRoutes);

module.exports = app;
