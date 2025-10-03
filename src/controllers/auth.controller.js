const prisma = require("../config/db");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { sendOtp } = require("../utils/otp");
const { sendEmail } = require("../utils/email");
const JWT_SECRET = process.env.JWT_SECRET || "dev-secret";

// ===========================
// Patient Registration with OTP
// ===========================
exports.registerPatient = async (req, res) => {
    try {
        const { fullName, email, password, gender, country, phone, birthdate } = req.body;
        const hashedPassword = await bcrypt.hash(password, 10);

        const user = await prisma.user.create({
            data: {
                fullName,
                email,
                password: hashedPassword,
                role: "PATIENT",
                patient: {
                    create: { gender, country, phone, birthdate: new Date(birthdate), verified: false }
                }
            },
            include: { patient: true }
        });

        const statusCallback = `${process.env.BACKEND_URL}/api/otp/status`;
        const otp = await sendOtp({ phone, email }, statusCallback);
        const expiry = new Date(Date.now() + 5 * 60 * 1000);

        await prisma.patient.update({
            where: { id: user.patient.id },
            data: { otp, otpExpiry: expiry }
        });

        res.status(201).json({ message: "Patient registered. OTP sent." });
    } catch (err) {
        console.error("Registration error:", err);
        res.status(500).json({ error: "Registration failed" });
    }
};

// ===========================
// OTP Verification with Resend on Expiry
// ===========================
exports.verifyOTP = async (req, res) => {
    try {
        const { email, otp } = req.body;

        const user = await prisma.user.findUnique({
            where: { email },
            include: { patient: true }
        });

        if (!user?.patient) return res.status(404).json({ error: "Patient not found" });

        const patient = user.patient;

        if (patient.verified) {
            return res.status(400).json({ error: "Already verified" });
        }

        // CASE 1: OTP expired → generate + resend
        if (new Date() > patient.otpExpiry) {
            const statusCallback = `${process.env.BACKEND_URL}/api/otp/status`;
            const newOtp = await sendOtp({ phone: patient.phone, email: user.email }, statusCallback);
            const newExpiry = new Date(Date.now() + 5 * 60 * 1000);

            await prisma.patient.update({
                where: { id: patient.id },
                data: { otp: newOtp, otpExpiry: newExpiry }
            });

            return res.status(400).json({
                error: "OTP expired. A new OTP has been sent.",
                resend: true
            });
        }

        // CASE 2: OTP mismatch
        if (patient.otp !== otp) {
            return res.status(400).json({ error: "Invalid OTP" });
        }

        // CASE 3: OTP valid
        await prisma.patient.update({
            where: { id: patient.id },
            data: { verified: true, otp: null, otpExpiry: null }
        });

        res.json({ message: "Verification successful. You can now log in." });
    } catch (err) {
        console.error("OTP verification error:", err);
        res.status(500).json({ error: "Verification failed" });
    }
};
// ===========================
// Register Doctor
// ===========================
exports.registerDoctor = async (req, res) => {
    try {
        const { email, password, department } = req.body;

        // Hash password
        const hashedPassword = await bcrypt.hash(password, 10);

        // Create user with role = DOCTOR
        const newDoctor = await prisma.user.create({
            data: {
                email,
                password: hashedPassword,
                role: "DOCTOR",
                doctor: {
                    create: {
                        mustChangePassword: true,
                        department: department,
                    }
                }
            },
            include: { doctor: true }
        });

        // Send welcome email with plain credentials
        const subject = "Welcome to Medtik - Onboarding Instructions";
        const html = `
            <div style="font-family: Arial, sans-serif; padding: 20px;">
                <img src="https://drive.google.com/uc?id=1qgi40MkD0jvxcudc_bnMt2Rp0WANpX30" alt="Medtik Logo" width="150" />
                <h2>Welcome on board! 👨‍⚕️👩‍⚕️</h2>
                <p>
                    We're excited to have you join Medtik! 🎉 <br/>
                    Here are your initial login credentials:
                </p>
                <ul>
                    <li><b>Email:</b> ${email}</li>
                    <li><b>Password:</b> ${password}</li>
                </ul>
                <p>
                    ⚠️ For security reasons, you will be required to change this password upon your first login.
                </p>
                <p>
                    Please log in to your account and complete your profile information
                    (availability, pricing, certifications, etc.).
                </p>
                <p>🚀 Let's help more patients together!</p>
                <hr/>
                <p style="font-size: 12px; color: #666;">This is an automated email. Do not reply.</p>
            </div>
        `;

        await sendEmail(email, subject, html);

        res.status(201).json({ message: "Doctor registered and welcome email sent." });
    } catch (err) {
        console.error("Doctor registration error:", err);
        res.status(500).json({ error: "Doctor registration failed" });
    }
};
// ===========================
// Common Login (Patients, Doctors, Admins)
// ===========================
exports.login = async (req, res) => {
    try {
        const { email, password } = req.body;

        const user = await prisma.user.findUnique({
            where: { email },
            include: { patient: true }
        });

        if (!user) return res.status(404).json({ error: "User not found" });

        const validPass = await bcrypt.compare(password, user.password);
        if (!validPass) return res.status(400).json({ error: "Invalid credentials" });

        // Prevent banned accounts from logging in
        if (user.status === "BANNED") {
            return res.status(403).json({ error: "Your account has been banned. Contact support." });
        }

        // If role is PATIENT → require verified
        if (user.role === "PATIENT" && !user.patient?.verified) {
            return res.status(403).json({ error: "Please verify your account with OTP first." });
        }

        const token = jwt.sign(
            { id: user.id, role: user.role },
            JWT_SECRET,
            { expiresIn: "1h" }
        );

        res.json({ message: "Login successful", token });
    } catch (err) {
        console.error("Login error:", err);
        res.status(500).json({ error: "Login failed" });
    }
};
// ===========================
// Change Password (Authenticated User)
// ===========================
exports.changePassword = async (req, res) => {
    try {
        const { currentPassword, newPassword } = req.body;
        const userId = req.user.id; // from verifyToken middleware

        const user = await prisma.user.findUnique({ where: { id: userId } });
        if (!user) return res.status(404).json({ error: "User not found" });

        const validPass = await bcrypt.compare(currentPassword, user.password);
        if (!validPass) return res.status(400).json({ error: "Current password is incorrect" });

        const hashedNewPass = await bcrypt.hash(newPassword, 10);
        await prisma.user.update({
            where: { id: userId },
            data: { password: hashedNewPass }
        });

        res.json({ message: "Password changed successfully" });
    } catch (err) {
        console.error("Change password error:", err);
        res.status(500).json({ error: "Failed to change password" });
    }
};
// ===========================
// Request Password Reset (Forgot Password)
// ===========================
exports.requestPasswordReset = async (req, res) => {
    try {
        const { email } = req.body;

        const user = await prisma.user.findUnique({ where: { email } });
        if (!user) return res.status(404).json({ error: "User not found" });

        const resetToken = jwt.sign(
            { id: user.id },
            JWT_SECRET,
            { expiresIn: "15m" } // token valid for 15 minutes
        );

        const resetLink = `${process.env.FRONTEND_URL}/reset-password?token=${resetToken}`;

        const subject = "Reset Your Medtik Password";
        const html = `
      <h2>Reset Password</h2>
      <p>Hello ${user.fullName || ""},</p>
      <p>Click the link below to reset your password. The link is valid for 15 minutes:</p>
      <a href="${resetLink}" style="color:#4CAF50">${resetLink}</a>
      <p>If you didn't request this, you can safely ignore it.</p>
    `;

        await sendEmail(email, subject, html);

        res.json({ message: "Password reset link sent to email" });
    } catch (err) {
        console.error("Request reset error:", err);
        res.status(500).json({ error: "Failed to request password reset" });
    }
};
// ===========================
// Reset Password with Reset Token
// ===========================
exports.resetPassword = async (req, res) => {
    try {
        const {newPassword } = req.body;
        const token = req.query.token
        const decoded = jwt.verify(token, JWT_SECRET);
        const userId = decoded.id;

        const hashedNewPass = await bcrypt.hash(newPassword, 10);

        await prisma.user.update({
            where: { id: userId },
            data: { password: hashedNewPass }
        });

        res.json({ message: "Password reset successful" });
    } catch (err) {
        console.error("Reset password error:", err);
        res.status(400).json({ error: "Invalid or expired reset token" });
    }
};
