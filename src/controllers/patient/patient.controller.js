const prisma = require("../../config/db");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const paymobService = require("../../services/paymob.service");

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

exports.getAllDoctors = async (req, res) => {
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
                            select: { id: true, date: true, startTime: true, endTime: true, chat: true, voice: true, video: true, notes: true },
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
// Reserve a doctor slot + Payment
// =========================
exports.reserveSlot = async (req, res) => {
    try {
        const patientUserId = req.user.id;
        const { slotId, serviceType } = req.body; // CHAT | VOICE | VIDEO

        if (!slotId || !serviceType)
            return res.status(400).json({ error: "slotId and serviceType are required" });

        // 1️⃣ Get patient info
        const user = await prisma.user.findUnique({
            where: { id: patientUserId },
            select: {
                id: true,
                fullName: true,
                email: true,
                patient: { select: { id: true, country: true } },
            },
        });

        if (!user || !user.patient)
            return res.status(404).json({ error: "Patient not found" });

        const patient = user.patient;

        // 2️⃣ Get slot & pricing
        const slot = await prisma.DoctorSlot.findUnique({
            where: { id: slotId },
            include: { doctor: { include: { pricing: true } } },
        });

        if (!slot) return res.status(404).json({ error: "Slot not found" });
        if (slot.status !== "AVAILABLE")
            return res.status(400).json({ error: "Slot is already reserved" });

        if (
            (serviceType === "CHAT" && !slot.chat) ||
            (serviceType === "VOICE" && !slot.voice) ||
            (serviceType === "VIDEO" && !slot.video)
        ) return res.status(400).json({ error: `This slot does not offer ${serviceType}` });

        // 3️⃣ Determine currency
        let currency = "USD";
        const country = patient.country?.toLowerCase();
        if (country === "egypt") currency = "EGP";
        else if (country === "saudi arabia") currency = "SAR";
        else if (country === "uae") currency = "AED";

        // 4️⃣ Get pricing
        const pricing = slot.doctor.pricing.find(
            p => p.service === serviceType && p.currency === currency
        );
        if (!pricing)
            return res.status(400).json({ error: `Service ${serviceType} not available in ${currency}` });

        // 5️⃣ Create appointment
        const appointment = await prisma.appointment.create({
            data: {
                doctorId: slot.doctorId,
                patientId: patient.id,
                appointmentType: serviceType,
                date: slot.date,
                notes: `Reserved via slot ${slotId}`,
            },
        });

        // 6️⃣ Reserve slot
        await prisma.DoctorSlot.update({
            where: { id: slotId },
            data: { status: "RESERVED" },
        });

        // 7️⃣ Create payment record
        const payment = await prisma.payment.create({
            data: {
                appointmentId: appointment.id,
                doctorId: slot.doctorId,
                patientId: patient.id,
                amount: pricing.price,
                currency: pricing.currency,
                status: "UNPAID",
            },
        });

        // 8️⃣ PayMob integration
        const authToken = await paymobService.getAuthToken();
        const orderId = await paymobService.createOrder(authToken, pricing.price, pricing.currency, payment.id);
        const paymentToken = await paymobService.getPaymentKey(authToken, orderId, pricing.price, pricing.currency, {
            first_name: user.fullName || "Patient",
            email: user.email,
        });

        // 9️⃣ Respond with appointment + payment info
        res.json({
            message: "Slot reserved successfully. Complete payment to confirm.",
            appointment,
            slotId: slot.id,
            payment: {
                id: payment.id,
                amount: pricing.price,
                currency: pricing.currency,
                paymobToken: paymentToken,
            },
        });
    } catch (err) {
        console.error(err.response?.data || err);
        res.status(500).json({ error: "Server error" });
    }
};

// =========================
// Cancel a reserved slot
// =========================
exports.cancelReservation = async (req, res) => {
    try {
        const patientUserId = req.user.id;

        const { appointmentId } = req.body;
        if (!appointmentId) return res.status(400).json({ error: "appointmentId is required" });

        // Get patient
        const user = await prisma.user.findUnique({
            where: { id: patientUserId },
            select: { patient: true },
        });

        if (!user || !user.patient) {
            return res.status(404).json({ error: "Patient not found" });
        }
        const patient=user.patient;
        // Get appointment
        const appointment = await prisma.appointment.findUnique({
            where: { id: appointmentId },
            include: { doctor: true },
        });

        if (!appointment) return res.status(404).json({ error: "Appointment not found" });
        if (appointment.patientId !== patient.id)
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
        const patientUserId = req.user.id;

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
            where: { patientId: patient.id },
            include: {
                doctor: {
                                department: true, // this gives you the department object


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
// =========================
// Get My Doctors that I have Appointments With
// =========================
exports.getMyDoctors = async (req, res) => {
    try {
        const patientUserId = req.user.id;

        // find patient by userId
        const user = await prisma.user.findUnique({
            where: { id: patientUserId },
            include: { patient: true },
        });

        if (!user?.patient) {
            return res.status(404).json({ error: "Patient not found" });
        }

        // get all appointments that are not cancelled
        const appointments = await prisma.appointment.findMany({
            where: {
                patientId: user.patient.id,
                NOT: { status: "CANCELLED" },
            },
            include: {
                doctor: {
                    include: {
                        user: { select: { id: true, fullName: true, email: true } },
                        department: true,
                    },
                },
            },
            orderBy: { date: "desc" },
        });

        // collect unique doctors
        const doctorsMap = new Map();
        appointments.forEach((appt) => {
            const doc = appt.doctor;
            if (!doctorsMap.has(doc.id)) {
                doctorsMap.set(doc.id, {
                    id: doc.id,
                    fullName: doc.user.fullName,
                    email: doc.user.email,
                    department: doc.department?.name || null,
                    lastAppointment: appt.date,
                });
            }
        });

        res.json({ doctors: Array.from(doctorsMap.values()) });
    } catch (err) {
        console.error("getMyDoctors error:", err);
        res.status(500).json({ error: "Server error" });
    }
};

// =========================
// Upload Medical Record
// =========================
exports.uploadMedicalRecord = async (req, res) => {
    try {
        const patientUserId = req.user.id; // from auth middleware
        const file = req.file;
        const { type, notes } = req.body;

        if (!file) return res.status(400).json({ error: "File is required" });

        // Find patient
        const patient = await prisma.patient.findUnique({
            where: { userId: patientUserId },
        });

        if (!patient) return res.status(404).json({ error: "Patient not found" });

        // Save record in DB
        const record = await prisma.medicalRecord.create({
            data: {
                patientId: patient.id,
                type,
                fileUrl: `/uploads/${file.filename}`, // store path on server
                notes,
            },
        });

        res.json({ message: "Medical record uploaded", record });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Server error" });
    }
};

exports.getMedicalRecords = async (req, res) => {
    try {
        const patientUserId = req.user.id;

        const patient = await prisma.patient.findUnique({
            where: { userId: patientUserId },
            include: { records: true },
        });

        if (!patient) return res.status(404).json({ error: "Patient not found" });

        res.json({ records: patient.records });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Server error" });
    }
};
