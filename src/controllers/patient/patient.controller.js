const prisma = require("../../config/db");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");

const JWT_SECRET = process.env.JWT_SECRET;


exports.updatePatient = async (req, res) => {
    try {
        const authHeader = req.headers.authorization;
        if (!authHeader?.startsWith("Bearer "))
            return res.status(401).json({ error: "No token" });

        const token = authHeader.split(" ")[1];
        const decoded = jwt.verify(token, JWT_SECRET);
        const userId = decoded.id; // from token

        const {
            fullName,
            email,
            password,
            phone,
            country,
            birthdate,
            gender,
        } = req.body;

        // Prepare nested update
        const userData = {};
        if (fullName) userData.fullName = fullName;
        if (email) userData.email = email;
        if (password) userData.password = await bcrypt.hash(password, 10);

        const patientData = {};
        if (phone) patientData.phone = phone;
        if (country) patientData.country = country;
        if (birthdate) patientData.birthdate = new Date(birthdate);
        if (gender) patientData.gender = gender;

        const updatedPatient = await prisma.patient.update({
            where: { userId },
            data: {
                ...patientData,
                user: {
                    update: userData,
                },
            },
            include: {
                user: true, // include user fields in the response
            },
        });

        res.json({
            message: "Patient updated successfully",
            patient: updatedPatient,
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Server error" });
    }
};

exports.getDoctors = async (req, res) => {
    try {
        // Get user from token
        const authHeader = req.headers.authorization;
        if (!authHeader?.startsWith("Bearer "))
            return res.status(401).json({ error: "No token" });

        const token = authHeader.split(" ")[1];
        const decoded = jwt.verify(token, JWT_SECRET);
        const userId = decoded.id;

        // Get patient's country
        const patient = await prisma.user.findUnique({
            where: { id: userId },
            select: { patient: true },
        });

        if (!patient || !patient.patient) {
            return res.status(404).json({ error: "Patient not found" });
        }

        const country = patient.patient.country;

        // Determine currency
        let currency = "USD";
        if (country.toLowerCase() === "egypt") currency = "EGP";
        else if (country.toLowerCase() === "saudi arabia") currency = "SAR";
        else if (country.toLowerCase() === "uae") currency = "AED";

        // Fetch doctors with pricing for this currency
        const doctors = await prisma.user.findMany({
            where: { role: "DOCTOR", status: "ACTIVE" },
            select: {
                id: true,
                fullName: true,
                email: true,
                doctor: {
                    select: {
                        title: true,
                        bio: true,
                        phone: true,
                        avatarUrl: true,
                        languages: true,
                        department: { select: { name: true } },
                        cancellationPolicy: true,
                        refundPolicy: true,
                        reschedulePolicy: true,
                        pricing: {
                            where: { currency },
                            select: { service: true, price: true },
                        },
                        availability: true,
                        DoctorSlot: {
                            where: { status: "AVAILABLE" },
                            select: { id: true, date: true, startTime: true, duration: true, chat: true, voice: true, video: true, notes: true },
                        },
                    },
                },
            },
        });

        // Format doctors
        const formatted = doctors
            .filter(u => u.doctor && u.doctor.pricing.length > 0)
            .map(u => {
                const availableServices = u.doctor.pricing.map(p => p.service);

                // Filter slots based on available services
                const filteredSlots = u.doctor.DoctorSlot.map(slot => ({
                    ...slot,
                    chat: slot.chat && availableServices.includes("CHAT"),
                    voice: slot.voice && availableServices.includes("VOICE"),
                    video: slot.video && availableServices.includes("VIDEO"),
                })).filter(slot => slot.chat || slot.voice || slot.video);

                // Adjust availability according to pricing
                const adjustedAvailability = u.doctor.availability
                    ? {
                        chat: u.doctor.availability.chat && availableServices.includes("CHAT"),
                        voice: u.doctor.availability.voice && availableServices.includes("VOICE"),
                        video: u.doctor.availability.video && availableServices.includes("VIDEO"),
                    }
                    : null;

                return {
                    id: u.id,
                    fullName: u.fullName,
                    email: u.email,
                    title: u.doctor.title,
                    bio: u.doctor.bio,
                    phone: u.doctor.phone,
                    avatarUrl: u.doctor.avatarUrl,
                    languages: u.doctor.languages,
                    department: u.doctor.department?.name,
                    policies: {
                        cancellation: u.doctor.cancellationPolicy,
                        refund: u.doctor.refundPolicy,
                        reschedule: u.doctor.reschedulePolicy,
                    },
                    pricing: u.doctor.pricing,
                    availability: adjustedAvailability,
                    availableSlots: filteredSlots,
                };
            });

        res.json({ doctors: formatted });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Server error" });
    }
};

// =========================
// Reserve a doctor slot
// =========================
exports.reserveSlot = async (req, res) => {
    try {
        const authHeader = req.headers.authorization;
        if (!authHeader?.startsWith("Bearer "))
            return res.status(401).json({ error: "No token provided" });

        const token = authHeader.split(" ")[1];
        const decoded = jwt.verify(token, JWT_SECRET);
        const patientUserId = decoded.id;

        const { slotId, serviceType } = req.body; // serviceType: CHAT | VOICE | VIDEO
        if (!slotId || !serviceType) {
            return res.status(400).json({ error: "slotId and serviceType are required" });
        }

        // Get patient
        const patient = await prisma.user.findUnique({
            where: { id: patientUserId },
            select: { patient: {
                    select: { id: true },
                } },
        });

        if (!patient || !patient.patient) {
            return res.status(404).json({ error: "Patient not found" });
        }

        // Get slot
        const slot = await prisma.doctorSlot.findUnique({
            where: { id: slotId },
            include: { doctor: { include: { pricing: true } } },
        });

        if (!slot) return res.status(404).json({ error: "Slot not found" });
        if (slot.status !== "AVAILABLE")
            return res.status(400).json({ error: "Slot is already reserved" });

        // Check if the doctor has pricing for the selected service
        const pricingForService = slot.doctor.pricing.find(p => p.service === serviceType);
        if (!pricingForService) {
            return res.status(400).json({ error: `Service ${serviceType} not available for this doctor` });
        }


        console.log(patient.patient);
        // Create appointment
        const appointment = await prisma.appointment.create({
            data: {
                doctorId: slot.doctorId,
                patientId: patientUserId,
                appointmentType: serviceType,
                date: slot.date,
                notes: `Reserved via slot ${slotId}`,
            },
        });

        // Reserve the slot
        const updatedSlot = await prisma.DoctorSlot.update({
            where: { id: slotId },
            data: { status: "RESERVED" },
        });

        res.json({
            message: "Slot reserved successfully",
            appointment,
            slot: updatedSlot,
            price: pricingForService.price,
            currency: pricingForService.currency,
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Server error" });
    }
};

// =========================
// Cancel a reserved slot
// =========================
exports.cancelReservation = async (req, res) => {
    try {
        const authHeader = req.headers.authorization;
        if (!authHeader?.startsWith("Bearer "))
            return res.status(401).json({ error: "No token provided" });

        const token = authHeader.split(" ")[1];
        const decoded = jwt.verify(token, JWT_SECRET);
        const patientUserId = decoded.id;

        const { appointmentId } = req.body;
        if (!appointmentId) return res.status(400).json({ error: "appointmentId is required" });

        // Get patient
        const patient = await prisma.user.findUnique({
            where: { id: patientUserId },
            select: { patient: true },
        });

        if (!patient || !patient.patient) {
            return res.status(404).json({ error: "Patient not found" });
        }

        // Get appointment
        const appointment = await prisma.appointment.findUnique({
            where: { id: appointmentId },
            include: { doctor: true },
        });

        if (!appointment) return res.status(404).json({ error: "Appointment not found" });
        if (appointment.patientId !== patientUserId)
            return res.status(403).json({ error: "This appointment does not belong to you" });

        // Update slot back to AVAILABLE
        const slot = await prisma.DoctorSlot.updateMany({
            where: { doctorId: appointment.doctorId, date: appointment.date },
            data: { status: "AVAILABLE" },
        });

        // Mark appointment as CANCELLED
        const cancelledAppointment = await prisma.appointment.update({
            where: { id: appointmentId },
            data: { status: "CANCELLED" },
        });

        res.json({
            message: "Reservation cancelled successfully",
            appointment: cancelledAppointment,
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Server error" });
    }
};

// =========================
// Get My Appointments (as patient)
// =========================
exports.getMyAppointments = async (req, res) => {
    try {
        const authHeader = req.headers.authorization;
        if (!authHeader?.startsWith("Bearer "))
            return res.status(401).json({ error: "No token provided" });

        const token = authHeader.split(" ")[1];
        const decoded = jwt.verify(token, JWT_SECRET);
        const patientUserId = decoded.id;

        // Get patient
        const user = await prisma.user.findUnique({
            where: { id: patientUserId },
            select: { patient: true },
        });
        const patient=user.patient;

        if (!patient) {
            return res.status(404).json({ error: "Patient not found" });
        }

        // Fetch appointments
        const appointments = await prisma.appointment.findMany({
            where: { patientId: patientUserId },
            include: {
                doctor: {
                    include: {
                        doctor: {
                            include: {
                                department: true, // this gives you the department object
                            },
                        },
                    },
                },
            },
            orderBy: { date: "desc" },
        });

        // Format response
        const formatted = appointments.map(a => ({
            id: a.id,
            type: a.appointmentType,
            status: a.status,
            date: a.date,
            notes: a.notes,
            doctor: {
                id: a.doctor.id,
                fullName: a.doctor.fullName,
                email: a.doctor.email,
                avatarUrl: a.doctor.avatarUrl,
                title: a.doctor.title,
                department: a.doctor.doctor?.department?.name || null,
                phone: a.doctor.phone,
            },
        }));

        res.json({ appointments: formatted });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Server error" });
    }
};
