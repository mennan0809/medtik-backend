const express = require('express');
const router = express.Router();
const authController = require('../controllers/auth.controller');

// Patient registration + OTP flow
router.post('/register-patient', authController.registerPatient);
router.post('/verify-otp', authController.verifyOTP);

// Common login (patients, doctors, admins)
router.post('/login', authController.login);

module.exports = router;
