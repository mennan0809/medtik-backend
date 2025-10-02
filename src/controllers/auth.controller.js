const prisma = require("../config/db");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { sendOtp } = require("../utils/otp");

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
            where: { id: user.Patient.id },
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
            include: { Patient: true }
        });

        if (!user?.Patient) return res.status(404).json({ error: "Patient not found" });

        const patient = user.Patient;

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
// Common Login (Patients, Doctors, Admins)
// ===========================
exports.login = async (req, res) => {
    try {
        const { email, password } = req.body;

        const user = await prisma.user.findUnique({
            where: { email },
            include: { Patient: true }
        });

        if (!user) return res.status(404).json({ error: "User not found" });

        const validPass = await bcrypt.compare(password, user.password);
        if (!validPass) return res.status(400).json({ error: "Invalid credentials" });

        // If role is PATIENT → require verified
        if (user.role === "PATIENT" && !user.Patient?.verified) {
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
