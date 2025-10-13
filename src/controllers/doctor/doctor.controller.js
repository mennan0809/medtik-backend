// controllers/doctorController.js
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const prisma = require("../../config/db");
const {refundPaymentThroughPaymob} = require("../../services/paymob.service");
const {pushNotification} = require("../../utils/notifications");

const JWT_SECRET = process.env.JWT_SECRET;

// =========================
// Update Doctor Profile
// =========================
exports.requestDoctorUpdate = async (req, res) => {
    try {
        const authHeader = req.headers.authorization;
        if (!authHeader?.startsWith("Bearer "))
            return res.status(401).json({ error: "No token" });

        const token = authHeader.split(" ")[1];
        let decoded;
        try {
            decoded = jwt.verify(token, JWT_SECRET);
        } catch (err) {
            return res.status(401).json({ error: "Invalid token" });
        }

        const userId = decoded.id;
        const user = await prisma.user.findUnique({
            where: { id: userId },
            include: { doctor: true }
        });

        if (!user || !user.doctor)
            return res.status(404).json({ error: "Doctor record not found" });

        // 🚨 check if doctor already has a pending request
        const existingPending = await prisma.doctorUpdateRequest.findFirst({
            where: { doctorId: user.doctor.id, status: "PENDING" }
        });

        if (existingPending) {
            return res.status(400).json({
                error: "You already have a pending update request. Please wait for review."
            });
        }

        const body = req.body;
        const types = [];
        const payload = {};

        // === mapping logic same as before ===
        if (body.bio || body.title || body.licenseNumber || body.yearsOfExperience || body.phone) {
            types.push("SERVICE");
            payload.service = {
                bio: body.bio,
                title: body.title,
                yearsOfExperience: body.yearsOfExperience,
                licenseNumber: body.licenseNumber,
                phone: body.phone,
            };
        }

        if (body.departmentId) {
            types.push("DEPARTMENT");
            payload.department = { departmentId: body.departmentId };
        }

        if (body.avatarUrl) {
            types.push("AVATAR");
            payload.avatar = { avatarUrl: body.avatarUrl };
        }

        if (body.languages || body.hospitals || body.education || body.certificates) {
            types.push("LANGUAGE");
            payload.language = {
                languages: body.languages,
                hospitals: body.hospitals,
                education: body.education,
                certificates: body.certificates,
            };
        }

        if (body.pricing) {
            types.push("PRICING");
            payload.pricing = body.pricing;
        }

        if (body.availability) {
            types.push("AVAILABILITY");
            payload.availability = body.availability;
        }

        if (
            body.videoProvider ||
            body.cancellationPolicy ||
            body.refundPolicy !== undefined ||
            body.reschedulePolicy
        ) {
            types.push("SERVICE");
            payload.service = {
                ...(payload.service || {}),
                videoProvider: body.videoProvider,
                cancellationPolicy: body.cancellationPolicy,
                refundPolicy: body.refundPolicy,
                reschedulePolicy: body.reschedulePolicy,
            };
        }

        if (body.password || body.fullName) {
            const userUpdates = {};

            if (body.password) {
                userUpdates.password = await bcrypt.hash(body.password, 10);
            }

            if (body.fullName) {
                userUpdates.fullName = body.fullName;
            }

            await prisma.user.update({
                where: { id: userId },
                data: userUpdates
            });
        }


        if (types.length === 0)
            return res.status(400).json({ error: "No valid fields to update" });

        // 🔥 if doctor is NEW, flip to PENDING
        if (user.doctor.status === "NEW") {
            await prisma.doctor.update({
                where: { id: user.doctor.id },
                data: { status: "PENDING" }
            });
        }

        // create update request
        const request = await prisma.doctorUpdateRequest.create({
            data: {
                doctorId: user.doctor.id,
                types,
                payload,
                status: "PENDING",
            }
        });

        res.json({ message: "Update request submitted", request });
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
        const doctorUserId = req.user.id; // doctor must be logged in
        const { date, startTime, endTime, chat, video, voice, notes } = req.body;
        const now = new Date();

        if (!date || !startTime || !endTime) {
            return res.status(400).json({ error: "Date, startTime, and endTime are required" });
        }

        const doctor = await prisma.doctor.findUnique({ where: { userId: doctorUserId } });
        if (!doctor) return res.status(404).json({ error: "Doctor not found" });

        // Convert to Date objects
        const slotStart = new Date(`${date}T${startTime}`);
        const slotEnd = new Date(`${date}T${endTime}`);

        if (slotStart < now) {
            return res.status(400).json({ error: "Cannot create a slot in the past" });
        }
        if (slotStart >= slotEnd) {
            return res.status(400).json({ error: "Start time must be before end time" });
        }

        // Check for overlapping slots
        const overlap = await prisma.DoctorSlot.findFirst({
            where: {
                doctorId: doctor.id,
                date: new Date(date),
                AND: [
                    { startTime: { lt: slotEnd } },
                    { endTime: { gt: slotStart } }
                ]
            }
        });

        if (overlap) {
            return res.status(400).json({ error: "This slot overlaps with an existing slot" });
        }

        // Create the slot
        const newSlot = await prisma.doctorSlot.create({
            data: {
                doctorId: doctor.id,
                date: new Date(date),
                chat: chat,
                video:video,
                voice:voice,
                notes:notes,
                startTime: slotStart,
                endTime: slotEnd,
            }
        });

        res.json({ message: "Slot created successfully", slot: newSlot });

    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Server error" });
    }
};

// =========================
// Get My Patients
// =========================
exports.getMyPatients = async (req, res) => {
    try {
        const doctorUserId = req.user.id;

        // Find doctor by userId
        const doctor = await prisma.doctor.findUnique({
            where: { userId: doctorUserId },
        });

        if (!doctor) {
            return res.status(404).json({ error: "Doctor not found" });
        }

        // Get all appointments that are not cancelled
        const appointments = await prisma.appointment.findMany({
            where: {
                doctorId: doctor.id,
                NOT: { status: "CANCELLED" },
            },
            include: {
                patient: {
                    include: {
                        user: {
                            select: {
                                id: true,
                                fullName: true,
                                email: true,
                                status: true,
                            },
                        },
                        records: true
                    },
                },
            },
            orderBy: { date: "desc" },
        });

        // Collect unique patients and attach last appointment date
        const patientsMap = new Map();
        appointments.forEach((appt) => {
            const patient = appt.patient;
            const patientId = patient.user.id;

            if (!patientsMap.has(patientId)) {
                patientsMap.set(patientId, {
                    id: patientId,
                    fullName: patient.user.fullName,
                    email: patient.user.email,
                    birthdate: patient.birthdate,
                    records: patient.records,
                    lastAppointment: appt.date,
                });
            }
        });

        res.json({ patients: Array.from(patientsMap.values()) });
    } catch (err) {
        console.error("getMyPatients error:", err);
        res.status(500).json({ error: "Server error" });
    }
};

// =========================
// Delete Slot
// =========================
exports.deleteSlot = async (req, res) => {
    try {
        const doctorUserId = req.user.id;
        const { id } = req.params;

        // Find doctor by user ID
        const doctor = await prisma.doctor.findUnique({ where: { userId: doctorUserId } });
        if (!doctor) return res.status(404).json({ error: "Doctor not found" });

        // Find slot by ID
        const slot = await prisma.doctorSlot.findUnique({
            where: { id: parseInt(id) },
        });

        if (!slot) return res.status(404).json({ error: "Slot not found" });
        if (slot.doctorId !== doctor.id)
            return res.status(403).json({ error: "Unauthorized to delete this slot" });
        if (slot.status === "RESERVED")
            return res.status(400).json({ error: "Cannot delete a Reserved slot" });

        // Delete slot
        await prisma.doctorSlot.delete({
            where: { id: parseInt(id) },
        });

        res.json({ message: "Slot deleted successfully" });
    } catch (err) {
        console.error("Error deleting slot:", err);
        res.status(500).json({ error: "Server error" });
    }
};

// =========================
// Mark Appointment as No Show
// =========================
exports.markAppointmentNoShow = async (req, res) => {
    try {
        const doctorUserId = req.user.id;
        const { appointmentId } = req.params;

        if (!appointmentId)
            return res.status(400).json({ error: "Appointment ID is required" });

        const doctor = await prisma.doctor.findUnique({
            where: { userId: doctorUserId },
            include: { user: true },
        });
        if (!doctor) return res.status(404).json({ error: "Doctor not found" });

        const appointment = await prisma.appointment.findUnique({
            where: { id: parseInt(appointmentId) },
            include: {
                payment: true,
                patient: { include: { user: true } },
            },
        });

        if (!appointment)
            return res.status(404).json({ error: "Appointment not found" });

        if (appointment.doctorId !== doctor.id)
            return res.status(403).json({ error: "Unauthorized" });

        if (appointment.status !== "CONFIRMED")
            return res.status(400).json({ error: "Only CONFIRMED appointments can be marked as no-show" });

        // Mark as no-show
        const updatedAppointment = await prisma.appointment.update({
            where: { id: appointment.id },
            data: { status: "NO_SHOW" },
        });

        let refundSuccess = false;

        // Check policy
        if (doctor.noShowPolicy && appointment.payment) {
            try {
                const refundResponse = await refundPaymentThroughPaymob(appointment.payment.transactionId);
                refundSuccess = true;
            } catch (refundErr) {
                console.error("Refund failed:", refundErr);
            }
        }

        // ===============================
        // 🔔 Notifications & Emails
        // ===============================

        // Notify patient
        await pushNotification({
            userId: appointment.patient.user.id,
            type: "APPOINTMENT",
            title: "Appointment Marked as No-Show",
            message: `Dr. ${doctor.user.fullName} marked your appointment as no-show.`,
            redirectUrl: `/patient/appointments/${appointment.id}`,
            metadata: { appointmentId: appointment.id },
            email: appointment.patient.user.email,
        });

        // Notify doctor (for confirmation)
        await pushNotification({
            userId: doctor.userId,
            type: "APPOINTMENT",
            title: "Appointment Marked as No-Show",
            message: `You marked the appointment with ${appointment.patient.user.fullName} as no-show.`,
            redirectUrl: `/doctor/appointments/${appointment.id}`,
            metadata: { appointmentId: appointment.id },
            email: doctor.user.email,
        });

        // Notify refund if applicable
        if (refundSuccess) {
            await pushNotification({
                userId: appointment.patient.user.id,
                type: "PAYMENT",
                title: "Refund Processed",
                message: `Your payment for the appointment with Dr. ${doctor.user.fullName} has been refunded.`,
                redirectUrl: `/patient/payments/${appointment.payment.id}`,
                metadata: { paymentId: appointment.payment.id },
                email: appointment.patient.user.email,
            });
        }

        res.json({
            message: doctor.noShowPolicy
                ? "Appointment marked as no-show and refund processed"
                : "Appointment marked as no-show (no refund per policy)",
            appointment: updatedAppointment,
        });

    } catch (err) {
        console.error("markAppointmentNoShow error:", err);
        res.status(500).json({ error: "Server error" });
    }
};


// =========================
// Mark Appointment as Completed
// =========================
exports.markAppointmentCompleted = async (req, res) => {
    try {
        const doctorUserId = req.user.id;
        const { appointmentId } = req.params;

        if (!appointmentId)
            return res.status(400).json({ error: "Appointment ID is required" });

        const doctor = await prisma.doctor.findUnique({
            where: { userId: doctorUserId },
            include: { user: true },
        });
        if (!doctor) return res.status(404).json({ error: "Doctor not found" });

        const appointment = await prisma.appointment.findUnique({
            where: { id: parseInt(appointmentId) },
            include: { patient: { include: { user: true } } },
        });

        if (!appointment)
            return res.status(404).json({ error: "Appointment not found" });

        if (appointment.doctorId !== doctor.id)
            return res.status(403).json({ error: "Unauthorized to modify this appointment" });

        if (appointment.status !== "CONFIRMED")
            return res.status(400).json({ error: "Only CONFIRMED appointments can be marked as completed" });

        const updated = await prisma.appointment.update({
            where: { id: appointment.id },
            data: { status: "COMPLETED" },
        });

        // ===============================
        // 🔔 Notifications & Emails
        // ===============================

        // Notify patient
        await pushNotification({
            userId: appointment.patient.user.id,
            type: "APPOINTMENT",
            title: "Appointment Completed",
            message: `Your appointment with Dr. ${doctor.user.fullName} has been marked as completed.`,
            redirectUrl: `/patient/appointments/${appointment.id}`,
            metadata: { appointmentId: appointment.id },
            email: appointment.patient.user.email,
        });

        // Notify doctor
        await pushNotification({
            userId: doctor.userId,
            type: "APPOINTMENT",
            title: "Appointment Completed",
            message: `You marked the appointment with ${appointment.patient.user.fullName} as completed.`,
            redirectUrl: `/doctor/appointments/${appointment.id}`,
            metadata: { appointmentId: appointment.id },
            email: doctor.user.email,
        });

        res.json({ message: "Appointment marked as completed", appointment: updated });
    } catch (err) {
        console.error("markAppointmentCompleted error:", err);
        res.status(500).json({ error: "Server error" });
    }
};

// =========================
// Cancel Appointment (Doctor)
// =========================
exports.cancelAppointment = async (req, res) => {
    try {
        const doctorUserId = req.user.id;
        const { appointmentId } = req.params;

        if (!appointmentId)
            return res.status(400).json({ error: "Appointment ID is required" });

        const doctor = await prisma.doctor.findUnique({
            where: { userId: doctorUserId },
            include: { user: true },
        });
        if (!doctor) return res.status(404).json({ error: "Doctor not found" });

        const appointment = await prisma.appointment.findUnique({
            where: { id: parseInt(appointmentId) },
            include: {
                payment: true,
                patient: { include: { user: true } },
            },
        });

        if (!appointment)
            return res.status(404).json({ error: "Appointment not found" });

        if (appointment.doctorId !== doctor.id)
            return res.status(403).json({ error: "Unauthorized to cancel this appointment" });

        // Free the slot
        await prisma.doctorSlot.updateMany({
            where: { doctorId: doctor.id, date: appointment.date },
            data: { status: "AVAILABLE" },
        });

        // Cancel appointment
        await prisma.appointment.update({
            where: { id: parseInt(appointmentId) },
            data: { status: "CANCELLED" },
        });

        let refundSuccess = false;
        if (appointment.payment) {
            try {
                await refundPaymentThroughPaymob(appointment.payment.transactionId);
                await prisma.payment.update({
                    where: { id: appointment.payment.id },
                    data: { status: "REFUNDED" },
                });
                refundSuccess = true;
            } catch (err) {
                console.error("Refund failed:", err);
            }
        }

        // ===============================
        // 🔔 Notifications & Emails
        // ===============================

        // Notify patient
        await pushNotification({
            userId: appointment.patient.user.id,
            type: 'APPOINTMENT',
            title: 'Appointment Cancelled',
            message: `Your appointment with Dr. ${doctor.user.fullName} on ${new Date(
                appointment.date
            ).toLocaleString()} has been cancelled by the doctor.`,
            redirectUrl: `/patient/appointments/${appointment.id}`,
            metadata: { appointmentId: appointment.id, doctorId: doctor.id },
            email: appointment.patient.user.email,
        });

        // Notify doctor
        await pushNotification({
            userId: doctor.user.id,
            type: 'APPOINTMENT',
            title: 'Appointment Cancelled',
            message: `You cancelled your appointment with ${appointment.patient.user.fullName}.`,
            redirectUrl: `/doctor/appointments/${appointment.id}`,
            metadata: { appointmentId: appointment.id, patientId: appointment.patient.user.id },
            email: doctor.user.email,
        });

        // Notify refund if applicable
        if (refundSuccess) {
            await pushNotification({
                userId: appointment.patient.user.id,
                type: 'PAYMENT',
                title: 'Refund Processed',
                message: `Your payment for the cancelled appointment with Dr. ${doctor.user.fullName} has been refunded.`,
                redirectUrl: `/patient/payments/${appointment.payment.id}`,
                metadata: { paymentId: appointment.payment.id },
                email: appointment.patient.user.email,
            });
        }

        res.json({
            message: refundSuccess
                ? "Appointment cancelled and refund processed"
                : "Appointment cancelled successfully",
        });
    } catch (err) {
        console.error("cancelAppointment error:", err);
        res.status(500).json({ error: "Server error" });
    }
};

// =========================
// Reschedule Appointment (Doctor)
// =========================
exports.rescheduleAppointment = async (req, res) => {
    try {
        const doctorUserId = req.user.id;
        const { appointmentId } = req.params;
        const { newDate, newStartTime, newEndTime } = req.body;

        if (!appointmentId || !newDate || !newStartTime || !newEndTime)
            return res.status(400).json({ error: "appointmentId, newDate, newStartTime, newEndTime are required" });

        const doctor = await prisma.doctor.findUnique({
            where: { userId: doctorUserId },
            include: { user: true },
        });
        if (!doctor) return res.status(404).json({ error: "Doctor not found" });

        const appointment = await prisma.appointment.findUnique({
            where: { id: parseInt(appointmentId) },
            include: { patient: { include: { user: true } } },
        });

        if (!appointment)
            return res.status(404).json({ error: "Appointment not found" });

        if (appointment.doctorId !== doctor.id)
            return res.status(403).json({ error: "Unauthorized to reschedule this appointment" });

        const newStart = new Date(`${newDate}T${newStartTime}`);
        const newEnd = new Date(`${newDate}T${newEndTime}`);
        if (newStart >= newEnd)
            return res.status(400).json({ error: "Start time must be before end time" });

        // Free old slot
        await prisma.doctorSlot.updateMany({
            where: { doctorId: doctor.id, date: appointment.date },
            data: { status: "AVAILABLE" },
        });

        // Update appointment
        await prisma.appointment.update({
            where: { id: appointment.id },
            data: {
                date: new Date(newDate),
                notes: `Rescheduled to ${newDate} ${newStartTime}-${newEndTime}`,
            },
        });

        // ===============================
        // 🔔 Notifications & Emails
        // ===============================

        // Notify patient
        await pushNotification({
            userId: appointment.patient.user.id,
            type: 'APPOINTMENT',
            title: 'Appointment Rescheduled',
            message: `Your appointment with Dr. ${doctor.user.fullName} has been rescheduled to ${newDate} (${newStartTime} - ${newEndTime}).`,
            redirectUrl: `/patient/appointments/${appointment.id}`,
            metadata: { appointmentId: appointment.id, doctorId: doctor.id },
            email: appointment.patient.user.email,
        });

        // Notify doctor
        await pushNotification({
            userId: doctor.user.id,
            type: 'APPOINTMENT',
            title: 'Appointment Rescheduled',
            message: `You rescheduled your appointment with ${appointment.patient.user.fullName} to ${newDate} (${newStartTime} - ${newEndTime}).`,
            redirectUrl: `/doctor/appointments/${appointment.id}`,
            metadata: { appointmentId: appointment.id, patientId: appointment.patient.user.id },
            email: doctor.user.email,
        });

        res.json({ message: "Appointment rescheduled successfully" });
    } catch (err) {
        console.error("rescheduleAppointment error:", err);
        res.status(500).json({ error: "Server error" });
    }
};

// =========================
// Get Doctor Appointments
// =========================
exports.getMyAppointments = async (req, res) => {
    try {
        const doctorUserId = req.user.id;

        // Find the doctor linked to this user
        const doctor = await prisma.doctor.findUnique({
            where: { userId: doctorUserId },
        });
        if (!doctor) return res.status(404).json({ error: "Doctor not found" });

        // Get all appointments for this doctor
        const appointments = await prisma.appointment.findMany({
            where: { doctorId: doctor.id },
            include: {
                patient: {
                    include: {
                        user: {
                            select: {
                                id: true,
                                fullName: true,
                                email: true,
                            },
                        },
                    },
                },
                payment: true,
                DoctorSlot: true,
            },
            orderBy: { date: "desc" }, // latest first
        });

        // Optional: categorize appointments
        const now = new Date();
        const categorized = {
            upcoming: appointments.filter(a => new Date(a.date) > now && a.status === "CONFIRMED"),
            completed: appointments.filter(a => a.status === "COMPLETED"),
            cancelled: appointments.filter(a => a.status === "CANCELLED"),
            noShow: appointments.filter(a => a.status === "NO_SHOW"),
        };

        res.json({
            message: "Appointments fetched successfully",
            total: appointments.length,
            categorized,
        });
    } catch (err) {
        console.error("getMyAppointments error:", err);
        res.status(500).json({ error: "Server error" });
    }
};
