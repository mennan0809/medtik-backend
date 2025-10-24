// controllers/doctorController.js
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const prisma = require("../../config/db");
const {refundPaymentThroughPaymob} = require("../../services/paymob.service");
const {pushNotification, pushAdminNotification} = require("../../utils/notifications");

const JWT_SECRET = process.env.JWT_SECRET;

// =========================
// Update Doctor Profile
// =========================
exports.requestDoctorUpdate = async (req, res) => {
    try {
        const userId = req.user.id;
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

        if (body.department) {
            types.push("DEPARTMENT");
            payload.department = body.department; // just store name directly
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
                noShowPolicy: body.noShowPolicy,
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

        if (user.doctor.status !== "ACCEPTED" ) {
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

        await pushAdminNotification({
            title: "Doctor Update Request",
            message: `Dr. ${user.fullName || "Unknown"} has submitted a profile update request.`,
            redirectUrl: `/admin/doctors/requests/${request.id}`,
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
        const userId = req.user.id;

        const user = await prisma.user.findUnique({
            where: { id: userId },
            include: {
                doctor: {
                    include: {
                        user: {
                            select: {
                                fullName: true,
                            },
                        },
                        department: true,
                        availability: true,
                        pricing: true,
                        doctorUpdateRequests: true,
                        Payment: true,
                        DoctorSlot: true,
                    },
                },
            },
        });

        if (!user || !user.doctor) return res.status(404).json({ error: "Doctor not found" });

        const doctor = {
            ...user.doctor,
            fullName: user.doctor.user?.fullName || null,
        };
        delete doctor.user; // remove nested user object

        res.json({ doctor: doctor });

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
                consultation: true,
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
                    userId: patient.user.id,
                    fullName: patient.user.fullName,
                    email: patient.user.email,
                    birthdate: patient.birthdate,
                    avatar: patient.avatarUrl,
                    records: patient.records,
                    lastAppointment: appt.date,
                    consultation: appt.consultation,
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
                Payment: true,
                patient: { include: { user: true } },
            },
        });

        if (!appointment)
            return res.status(404).json({ error: "Appointment not found" });

        if (appointment.doctorId !== doctor.id)
            return res.status(403).json({ error: "Unauthorized" });

        if (appointment.status !== "CONFIRMED")
            return res.status(400).json({ error: "Only CONFIRMED appointments can be marked as no-show" });

        const now = new Date();
        const appointmentDateTime = new Date(appointment.endTime || appointment.date);

        if (appointmentDateTime > now)
            return res.status(400).json({ error: "You cannot mark an upcoming appointment as No Show" });

        // Mark as no-show
        const updatedAppointment = await prisma.appointment.update({
            where: { id: appointment.id },
            data: { status: "NO_SHOW" },
        });

        let refundSuccess = false;

        // Check policy
        if (doctor.noShowPolicy && appointment.Payment) {
            try {
                const refundResponse = await refundPaymentThroughPaymob(appointment.Payment.paymobTransactionId);
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
                redirectUrl: `/patient/payments/${appointment.Payment.id}`,
                metadata: { paymentId: appointment.Payment.id },
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

        // 🚨 Check that appointment date/time has passed
        const now = new Date();
        const appointmentDateTime = new Date(appointment.endTime || appointment.date);

        if (appointmentDateTime > now)
            return res.status(400).json({ error: "You cannot mark an upcoming appointment as completed" });

        // ✅ Mark as completed
        const updated = await prisma.appointment.update({
            where: { id: appointment.id },
            data: { status: "COMPLETED" },
        });

        // ===============================
        // 🔔 Notifications & Emails
        // ===============================

        await pushNotification({
            userId: appointment.patient.user.id,
            type: "APPOINTMENT",
            title: "Appointment Completed",
            message: `Your appointment with Dr. ${doctor.user.fullName} has been marked as completed.`,
            redirectUrl: `/patient/appointments/${appointment.id}`,
            metadata: { appointmentId: appointment.id },
            email: appointment.patient.user.email,
        });

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
// Cancel Appointment (Doctor) - DEBUG VERSION
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
        if (!doctor) {
            console.warn("❌ Doctor not found for user:", doctorUserId);
            return res.status(404).json({ error: "Doctor not found" });
        }

        const appointment = await prisma.appointment.findUnique({
            where: { id: parseInt(appointmentId) },
            include: {
                Payment: true,
                patient: { include: { user: true } },
            },
        });

        if (!appointment) {
            console.warn("❌ Appointment not found:", appointmentId);
            return res.status(404).json({ error: "Appointment not found" });
        }



        if (appointment.doctorId !== doctor.id) {
            console.warn("⚠️ Unauthorized cancellation attempt by doctor:", doctor.id);
            return res.status(403).json({ error: "Unauthorized to cancel this appointment" });
        }

        if (appointment.status !== "CONFIRMED") {
            console.warn("⚠️ Attempt to cancel a non-confirmed appointment:", appointment.status);
            return res.status(400).json({
                error: `Only CONFIRMED appointments can be cancelled. Current status: ${appointment.status}`
            });
        }

        // Free the slot
        const freedSlots = await prisma.doctorSlot.updateMany({
            where: { doctorId: doctor.id, startTime: appointment.date },
            data: { status: "AVAILABLE" },
        });

        // Cancel appointment
        await prisma.appointment.update({
            where: { id: parseInt(appointmentId) },
            data: { status: "CANCELLED" },
        });

        let refundSuccess = false;
        if (appointment.Payment) {
            try {
                const refundResponse = await refundPaymentThroughPaymob(appointment.Payment.paymobTransactionId);

                const updatedPayment = await prisma.payment.update({
                    where: { id: appointment.Payment.id },
                    data: { status: "REFUNDED" },
                });

                refundSuccess = true;
            } catch (err) {
                console.error("❌ Refund failed:", err.message || err);
                if (err.response) {
                    console.error("🔍 Paymob error response:", err.response.data || err.response);
                }
            }
        }

        // ===============================
        // 🔔 Notifications
        // ===============================

        await pushNotification({
            userId: appointment.patient.user.id,
            type: "APPOINTMENT",
            title: "Appointment Cancelled",
            message: `Your appointment with Dr. ${doctor.user.fullName} on ${new Date(
                appointment.date
            ).toLocaleString()} has been cancelled by the doctor.`,
            redirectUrl: `/patient/appointments/${appointment.id}`,
            metadata: { appointmentId: appointment.id, doctorId: doctor.id },
            email: appointment.patient.user.email,
        });

        await pushNotification({
            userId: doctor.user.id,
            type: "APPOINTMENT",
            title: "Appointment Cancelled",
            message: `You cancelled your appointment with ${appointment.patient.user.fullName}.`,
            redirectUrl: `/doctor/appointments/${appointment.id}`,
            metadata: { appointmentId: appointment.id, patientId: appointment.patient.user.id },
            email: doctor.user.email,
        });

        if (refundSuccess) {
            await pushNotification({
                userId: appointment.patient.user.id,
                type: "PAYMENT",
                title: "Refund Processed",
                message: `Your payment for the cancelled appointment with Dr. ${doctor.user.fullName} has been refunded.`,
                redirectUrl: `/patient/payments/${appointment.Payment.id}`,
                metadata: { paymentId: appointment.Payment.id },
                email: appointment.patient.user.email,
            });
        }

        res.json({
            message: refundSuccess
                ? "Appointment cancelled and refund processed ✅"
                : "Appointment cancelled (refund failed or not required)",
        });
    } catch (err) {
        console.error("💥 cancelAppointment error:", err);
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
        const { newSlotId } = req.body;

        // Validation
        if (!appointmentId || !newSlotId)
            return res.status(400).json({ error: "appointmentId and newSlotId are required" });

        // Get doctor
        const doctor = await prisma.doctor.findUnique({
            where: { userId: doctorUserId },
            include: { user: true },
        });
        if (!doctor) return res.status(404).json({ error: "Doctor not found" });

        // Get appointment
        const appointment = await prisma.appointment.findUnique({
            where: { id: parseInt(appointmentId) },
            include: { patient: { include: { user: true } } },
        });
        if (!appointment)
            return res.status(404).json({ error: "Appointment not found" });

        if (appointment.doctorId !== doctor.id)
            return res.status(403).json({ error: "Unauthorized to reschedule this appointment" });

        if (appointment.status !== "CONFIRMED") {
            return res.status(400).json({
                error: `Only CONFIRMED appointments can be rescheduled. Current status: ${appointment.status}`
            });
        }
        // Get new slot
        const newSlot = await prisma.doctorSlot.findUnique({
            where: { id: parseInt(newSlotId) },
        });
        if (!newSlot)
            return res.status(404).json({ error: "New slot not found" });

        if (newSlot.status !== "AVAILABLE")
            return res.status(400).json({ error: "This slot is not available" });

        if (newSlot.doctorId !== doctor.id)
            return res.status(403).json({ error: "You can only use your own slots" });

        // Start transaction
        await prisma.$transaction(async (tx) => {
            // Free the old slot
            await tx.doctorSlot.updateMany({
                where: { doctorId: doctor.id, startTime: appointment.date },
                data: { status: "AVAILABLE" },
            });

            // Mark new slot as reserved
            await tx.doctorSlot.update({
                where: { id: newSlot.id },
                data: { status: "RESERVED" },
            });

            // Update appointment to new slot
            await tx.appointment.update({
                where: { id: appointment.id },
                data: {
                    date: newSlot.date,
                    notes: `Rescheduled to ${newSlot.date.toISOString()} (${newSlot.startTime.toISOString()} - ${newSlot.endTime.toISOString()})`,
                },
            });
        });

        // Send notifications
        await pushNotification({
            userId: appointment.patient.user.id,
            type: 'APPOINTMENT',
            title: 'Appointment Rescheduled',
            message: `Your appointment with Dr. ${doctor.user.fullName} has been rescheduled to ${newSlot.date.toDateString()} (${newSlot.startTime.toLocaleTimeString()} - ${newSlot.endTime.toLocaleTimeString()}).`,
            redirectUrl: `/patient/appointments/${appointment.id}`,
            metadata: { appointmentId: appointment.id, doctorId: doctor.id },
            email: appointment.patient.user.email,
        });

        await pushNotification({
            userId: doctor.user.id,
            type: 'APPOINTMENT',
            title: 'Appointment Rescheduled',
            message: `You rescheduled your appointment with ${appointment.patient.user.fullName} to ${newSlot.date.toDateString()} (${newSlot.startTime.toLocaleTimeString()} - ${newSlot.endTime.toLocaleTimeString()}).`,
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
                Payment: true
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
// =========================
// CREATE Consultation
// =========================
exports.createConsultation = async (req, res) => {
    try {
        const doctorUserId = req.user.id;
        const appointmentId = Number(req.params.appointmentId);
        const { notes, diagnosis, prescriptions } = req.body;

        const doctor = await prisma.doctor.findUnique({ where: { userId: doctorUserId } });
        if (!doctor) return res.status(404).json({ error: "Doctor not found" });

        const appointment = await prisma.appointment.findUnique({ where: { id: appointmentId } });
        if (!appointment) return res.status(404).json({ error: "Appointment not found" });
        if (appointment.doctorId !== doctor.id) return res.status(403).json({ error: "Not authorized for this appointment" });

        const existing = await prisma.consultation.findUnique({ where: { appointmentId } });
        if (existing) return res.status(400).json({ error: "Consultation already exists for this appointment" });

        const consultation = await prisma.consultation.create({
            data: {
                appointmentId,
                notes,
                diagnosis,
                prescriptions,
            },
        });

        res.json({ message: "Consultation created", consultation });
    } catch (err) {
        console.error("createConsultation error:", err);
        res.status(500).json({ error: "Server error" });
    }
};

// =========================
// READ (All Doctor's Consultations)
// =========================
exports.getMyConsultations = async (req, res) => {
    try {
        const doctorUserId = req.user.id;
        const doctor = await prisma.doctor.findUnique({ where: { userId: doctorUserId } });
        if (!doctor) return res.status(404).json({ error: "Doctor not found" });

        const consultations = await prisma.consultation.findMany({
            where: { doctorId: doctor.id },
            include: {
                appointment: true,
                patient: { include: { user: { select: { id: true, fullName: true, email: true } } } },
            },
            orderBy: { createdAt: "desc" },
        });

        res.json({ message: "Consultations fetched", consultations });
    } catch (err) {
        console.error("getMyConsultations error:", err);
        res.status(500).json({ error: "Server error" });
    }
};

// =========================
// READ Single Consultation
// =========================
exports.getConsultationById = async (req, res) => {
    try {
        const doctorUserId = req.user.id;
        const { id } = req.params;

        const doctor = await prisma.doctor.findUnique({ where: { userId: doctorUserId } });
        if (!doctor) return res.status(404).json({ error: "Doctor not found" });

        const consultation = await prisma.consultation.findUnique({
            where: { id: Number(id) },
            include: {
                appointment: true,
                patient: { include: { user: { select: { id: true, fullName: true, email: true } } } },
            },
        });

        if (!consultation || consultation.doctorId !== doctor.id) {
            return res.status(403).json({ error: "Not authorized to view this consultation" });
        }

        res.json({ consultation });
    } catch (err) {
        console.error("getConsultationById error:", err);
        res.status(500).json({ error: "Server error" });
    }
};

// =========================
// UPDATE Consultation
// =========================
exports.updateConsultation = async (req, res) => {
    try {
        const doctorUserId = req.user.id;
        const id = Number(req.params.consultationId);
        const { notes, diagnosis, prescriptions } = req.body;

        const doctor = await prisma.doctor.findUnique({ where: { userId: doctorUserId } });
        if (!doctor) return res.status(404).json({ error: "Doctor not found" });

        const consultation = await prisma.consultation.findUnique({ where: { id: Number(id) } });
        if (!consultation) {
            return res.status(403).json({ error: "Consultation Not Found" });
        }

        const updated = await prisma.consultation.update({
            where: { id: Number(id) },
            data: { notes, diagnosis, prescriptions },
        });

        res.json({ message: "Consultation updated", consultation: updated });
    } catch (err) {
        console.error("updateConsultation error:", err);
        res.status(500).json({ error: "Server error" });
    }
};

// =========================
// DELETE Consultation
// =========================
exports.deleteConsultation = async (req, res) => {
    try {
        const doctorUserId = req.user.id;
        const  id  = req.params.consultationId;

        const doctor = await prisma.doctor.findUnique({ where: { userId: doctorUserId } });
        if (!doctor) return res.status(404).json({ error: "Doctor not found" });

        const consultation = await prisma.consultation.findUnique({ where: { id: Number(id) } });
        if (!consultation) {
            return res.status(403).json({ error: "Not authorized to delete this consultation" });
        }

        await prisma.consultation.delete({ where: { id: Number(id) } });
        res.json({ message: "Consultation deleted" });
    } catch (err) {
        console.error("deleteConsultation error:", err);
        res.status(500).json({ error: "Server error" });
    }
};

// =========================
// READ Consultations by Appointment
// =========================
exports.getConsultationsByAppointment = async (req, res) => {
    try {
        const doctorUserId = req.user.id;
        const { appointmentId } = req.params;

        const doctor = await prisma.doctor.findUnique({ where: { userId: doctorUserId } });
        if (!doctor) return res.status(404).json({ error: "Doctor not found" });

        const appointment = await prisma.appointment.findUnique({ where: { id: Number(appointmentId) } });
        if (!appointment) return res.status(404).json({ error: "Appointment not found" });
        if (appointment.doctorId !== doctor.id) return res.status(403).json({ error: "Not authorized" });

        const consultation = await prisma.consultation.findUnique({
            where: { appointmentId: Number(appointmentId) }
        });

        res.json({ message: "Consultations fetched for appointment", consultation });
    } catch (err) {
        console.error("getConsultationsByAppointment error:", err);
        res.status(500).json({ error: "Server error" });
    }
};
