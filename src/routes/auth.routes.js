const express = require('express');
const router = express.Router();
const authController = require('../controllers/auth.controller');
const { verifyToken, requireRole } = require("../middleware/auth");

// Patient registration + OTP flow
router.post('/register-patient', authController.registerPatient);
router.post('/verify-otp', authController.verifyOTP);

// Doctor Registration
router.post(
    "/register-doctor",
    verifyToken,
    requireRole("ADMIN"),
    authController.registerDoctor
);

// Common login (patients, doctors, admins)
router.post('/login', authController.login);

// Change password (requires login)
router.post("/change-password", verifyToken, authController.changePassword);

// Forgot password flow
router.post("/request-password-reset", authController.requestPasswordReset);
router.post("/reset-password", authController.resetPassword);

module.exports = router;
