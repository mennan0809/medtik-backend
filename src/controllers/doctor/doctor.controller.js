// controllers/doctorController.js
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const prisma = require("../../config/db");

const JWT_SECRET = process.env.JWT_SECRET;

// =========================
// Update Doctor Profile
// =========================
exports.updateDoctor = async (req, res) => {
    try {
        const authHeader = req.headers.authorization;
        if (!authHeader?.startsWith("Bearer ")) return res.status(401).json({ error: "No token" });

        const token = authHeader.split(" ")[1];
        let decoded;
        try {
            decoded = jwt.verify(token, JWT_SECRET);
        } catch (err) {
            return res.status(401).json({ error: "Invalid token" });
        }

        const userId = decoded.id;

        // Get the user + doctor
        const user = await prisma.user.findUnique({
            where: { id: userId },
            include: { doctor: true }
        });

        if (!user || !user.doctor) return res.status(404).json({ error: "Doctor record not found" });

        const { password, pricing, availability, ...rest } = req.body;
        const doctorUpdates = { ...rest };

        // Password change
        if (password) {
            const hashedPass = await bcrypt.hash(password, 10);
            await prisma.user.update({ where: { id: userId }, data: { password: hashedPass } });
            doctorUpdates.mustChangePassword = false;
        }

        // Pricing update
        if (pricing) {
            doctorUpdates.pricing = {
                deleteMany: {},
                create: pricing,
            };
        }

        // Availability update
        if (availability) {
            doctorUpdates.availability = {
                upsert: {
                    create: availability,
                    update: availability,
                },
            };
        }

        if (Object.keys(doctorUpdates).length === 0) return res.status(400).json({ error: "No valid fields to update" });

        const updatedDoctor = await prisma.doctor.update({
            where: { id: user.doctor.id },
            data: doctorUpdates,
        });

        res.json({ message: "Doctor updated successfully", doctor: updatedDoctor });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Server error" });
    }
};

// =========================
// Get Doctor Profile
// =========================
exports.getDoctorProfile = async (req, res) => {
    try {
        const authHeader = req.headers.authorization;
        if (!authHeader?.startsWith("Bearer ")) return res.status(401).json({ error: "No token" });

        const token = authHeader.split(" ")[1];
        const decoded = jwt.verify(token, JWT_SECRET);
        const userId = decoded.id;

        const user = await prisma.user.findUnique({
            where: { id: userId },
            include: {
                doctor: {
                    include: {
                        department: true,
                        availability: true,
                        pricing: true,
                        doctorUpdateRequests: true,
                        Payment: true,
                        Consultation: true,
                        DoctorSlot: true,
                    }
                }
            }
        });

        if (!user || !user.doctor) return res.status(404).json({ error: "Doctor not found" });

        res.json({ doctor: user.doctor });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Server error" });
    }
};

// =========================
// Add Doctor Slot
// =========================
exports.addSlot = async (req, res) => {
    try {
        const authHeader = req.headers.authorization;
        if (!authHeader?.startsWith("Bearer ")) return res.status(401).json({ error: "No token" });

        const token = authHeader.split(" ")[1];
        const decoded = jwt.verify(token, JWT_SECRET);
        const userId = decoded.id;

        const user = await prisma.user.findUnique({
            where: { id: userId },
            include: { doctor: true }
        });

        if (!user || !user.doctor) return res.status(404).json({ error: "Doctor record not found" });

        const { date, startTime, duration, chat, voice, video, notes } = req.body;
        if (!date || !startTime || !duration) return res.status(400).json({ error: "Date, startTime, and duration are required" });

        const slot = await prisma.doctorSlot.create({
            data: {
                doctorId: userId,
                date: new Date(date),
                startTime: new Date(startTime),
                duration,
                chat: !!chat,
                voice: !!voice,
                video: !!video,
                notes,
            },
        });

        res.json({ slot });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Server error" });
    }
};


