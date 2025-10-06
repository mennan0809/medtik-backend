const prisma = require("../../config/db");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const paymobService = require("../../services/paymob.service");
const { convertToEGP } = require("../../services/currency.service");
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
// Reserve a doctor slot + Payment (PayMob)
// =========================
exports.reserveSlot = async (req, res) => {
    try {
        const patientUserId = req.user.id;
        const { slotId, serviceType } = req.body;

        if (!slotId || !serviceType)
            return res.status(400).json({ error: "slotId and serviceType are required" });

        const user = await prisma.user.findUnique({
            where: { id: patientUserId },
            select: {
                id: true,
                fullName: true,
                email: true,
                patient: { select: { id: true, country: true, phone: true } },
            },
        });
        if (!user?.patient)
            return res.status(404).json({ error: "Patient not found" });

        const patient = user.patient;

        const { appointment, slot, pricing, currency } = await prisma.$transaction(async (tx) => {
            const slot = await tx.doctorSlot.findUnique({
                where: { id: slotId },
                include: { doctor: { include: { pricing: true } } },
            });

            if (!slot) throw new Error("Slot not found");
            if (slot.status !== "AVAILABLE") throw new Error("Slot already reserved");

            let currency = "USD";
            const country = patient.country?.toLowerCase();
            if (country === "egypt") currency = "EGP";
            else if (country === "saudi arabia") currency = "SAR";
            else if (country === "uae") currency = "AED";

            const pricing = slot.doctor.pricing.find(
                (p) => p.service === serviceType && p.currency === currency
            );
            if (!pricing)
                throw new Error(`Service ${serviceType} not available in ${currency}`);

            const updatedSlot = await tx.doctorSlot.update({
                where: { id: slotId },
                data: { status: "RESERVED" },
            });

            const appointment = await tx.appointment.create({
                data: {
                    doctorId: slot.doctorId,
                    patientId: patient.id,
                    appointmentType: serviceType,
                    date: slot.date,
                    notes: `Reserved via slot ${slotId}`,
                },
            });

            return { appointment, slot: updatedSlot, pricing, currency };
        });

        let amount = pricing.price;
        if (currency !== "EGP") {
            amount = await convertToEGP(pricing.price, currency);
        }

        const payment = await prisma.payment.create({
            data: {
                appointmentId: appointment.id,
                doctorId: slot.doctorId,
                patientId: patient.id,
                amount,
                currency: "EGP",
                status: "UNPAID",
            },
        });

        const authToken = await paymobService.getAuthToken();
        const uniqueMerchantId = `PAY-${payment.id}-${Date.now()}`;

        const orderId = await paymobService.createOrder(
            authToken,
            amount,
            "EGP",
            uniqueMerchantId
        );

        const paymentToken = await paymobService.getPaymentKey(
            authToken,
            orderId,
            amount,
            "EGP",
            {
                first_name: user.fullName || "Patient",
                last_name: "User",
                email: user.email,
                phone_number: patient.phone || "0000000000",
                street: "Default Street",
                building: "1",
                floor: "1",
                apartment: "1",
                city: "Cairo",
                country: patient.country || "Egypt",
            }
        );

        // ✅ Ready-to-redirect Paymob payment URL
        const IFRAME_ID = process.env.PAYMOB_IFRAME_ID; // store it in your .env
        const redirectUrl = `https://accept.paymob.com/api/acceptance/iframes/${IFRAME_ID}?payment_token=${paymentToken}`;

        // 🧠 Return redirect link only
        res.json({
            message: "Slot reserved successfully. Redirect to payment URL.",
            redirectUrl,
        });
    } catch (err) {
        if (err.message.includes("already reserved"))
            return res.status(400).json({ error: "This slot is already reserved." });

        if (err.code === "P2002")
            return res.status(400).json({ error: "Duplicate booking attempt." });

        console.error("Reserve slot error:", err);
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
// =========================
// GET PATIENT PROFILE
// =========================
exports.getPatientProfile = async (req, res) => {
    try {
        const userId = req.user.id;

        const user = await prisma.user.findUnique({
            where: { id: userId },
            include: { patient: true },
        });

        if (!user || !user.patient) {
            return res.status(404).json({ error: "Patient profile not found" });
        }

        res.json({ user });
    } catch (err) {
        console.error("getPatientProfile error:", err);
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

        if (!appointmentId)
            return res.status(400).json({ error: "appointmentId is required" });

        // Get patient
        const user = await prisma.user.findUnique({
            where: { id: patientUserId },
            include: { patient: true },
        });

        if (!user?.patient)
            return res.status(404).json({ error: "Patient not found" });

        const patient = user.patient;

        // Get appointment + related doctor + payment
        const appointment = await prisma.appointment.findUnique({
            where: { id: appointmentId },
            include: {
                doctor: true,
                payment: true,
            },
        });

        if (!appointment)
            return res.status(404).json({ error: "Appointment not found" });

        if (appointment.patientId !== patient.id)
            return res.status(403).json({ error: "This appointment does not belong to you" });

        if (["CANCELLED", "COMPLETED", "NO_SHOW"].includes(appointment.status))
            return res.status(400).json({ error: "This appointment cannot be cancelled" });

        // Time difference in hours between now and appointment time
        const now = new Date();
        const appointmentTime = new Date(appointment.date);
        const diffHours = (appointmentTime - now) / (1000 * 60 * 60);

        const canRefund = diffHours >= appointment.doctor.cancellationPolicy;

        // Update appointment + free up slot
        await prisma.$transaction(async (tx) => {
            await tx.appointment.update({
                where: { id: appointment.id },
                data: { status: "CANCELLED" },
            });

            // Free the slot
            await tx.doctorSlot.updateMany({
                where: {
                    doctorId: appointment.doctorId,
                    date: appointment.date,
                },
                data: { status: "AVAILABLE" },
            });

            // Handle refund if applicable
            if (canRefund && appointment.payment) {
                try {
                    await paymobService.refundPaymentThroughPaymob(appointment.payment.transactionId);
                    await tx.payment.update({
                        where: { id: appointment.payment.id },
                        data: { status: "REFUNDED" },
                    });
                } catch (refundErr) {
                    console.error("Refund failed:", refundErr);
                    throw new Error("Appointment cancelled, but refund failed");
                }
            }
        });

        res.json({
            message: canRefund
                ? "Appointment cancelled successfully and refund processed"
                : "Appointment cancelled successfully (no refund due to policy)",
        });
    } catch (err) {
        console.error("cancelReservation error:", err);
        res.status(500).json({ error: "Server error" });
    }
};

// =========================
// Reschedule Appointment
// =========================
exports.rescheduleAppointment = async (req, res) => {
    try {
        const { appointmentId, newSlotId } = req.body;
        const userId = req.user.id; // patient must be logged in

        const appointment = await prisma.appointment.findUnique({
            where: { id: appointmentId },
            include: {
                slot: true,
                doctor: true,
                patient: { include: { user: true } }
            }
        });

        if (!appointment) return res.status(404).json({ error: "Appointment not found" });
        if (appointment.status !== "CONFIRMED")
            return res.status(400).json({ error: "Only confirmed appointments can be rescheduled" });

        // Ensure patient owns this appointment
        const patient = await prisma.patient.findUnique({ where: { userId } });
        if (appointment.patientId !== patient.id)
            return res.status(403).json({ error: "You cannot reschedule this appointment" });

        const doctor = await prisma.doctor.findUnique({
            where: { id: appointment.doctorId },
            select: { reschedulePolicy: true }
        });

        const policyHours = doctor.reschedulePolicy || 0;
        const now = new Date();
        const timeUntilAppointment = (appointment.slot.startTime - now) / (1000 * 60 * 60);

        if (timeUntilAppointment < policyHours) {
            return res.status(400).json({
                error: `Cannot reschedule less than ${policyHours} hours before appointment`
            });
        }

        // Validate new slot
        const newSlot = await prisma.doctorSlot.findUnique({
            where: { id: newSlotId },
            include: { doctor: true }
        });

        if (!newSlot) return res.status(404).json({ error: "New slot not found" });
        if (newSlot.doctorId !== appointment.doctorId)
            return res.status(400).json({ error: "Slot must belong to the same doctor" });
        if (newSlot.isBooked) return res.status(400).json({ error: "Slot is already booked" });
        if (newSlot.startTime < new Date())
            return res.status(400).json({ error: "Cannot reschedule to a past slot" });

        // Update appointment
        await prisma.$transaction([
            prisma.appointment.update({
                where: { id: appointmentId },
                data: {
                    slotId: newSlotId,
                    date: newSlot.date,
                    status: "CONFIRMED",
                }
            }),
            prisma.doctorSlot.update({
                where: { id: appointment.slotId },
                data: { isBooked: false }
            }),
            prisma.doctorSlot.update({
                where: { id: newSlotId },
                data: { isBooked: true }
            })
        ]);

        res.json({ message: "Appointment rescheduled successfully" });

    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Server error" });
    }
};
