const prisma = require("../../config/db");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const paymobService = require("../../services/paymob.service");
const { convertToEGP } = require("../../services/currency.service");
const {pushNotification} = require("../../utils/notifications");
const JWT_SECRET = process.env.JWT_SECRET;
const fs = require("fs");
const path = require("path");

exports.updatePatient = async (req, res) => {
    try {
        const userId = req.user.id;

        const {
            fullName,
            email,
            password,
            phone,
            country,
            birthdate,
            gender,
            avatarUrl
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
        if(avatarUrl) patientData.avatarUrl = avatarUrl;

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
        const userId = req.user.id;

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
                        noShowPolicy: true,
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
                // Aggregate reviews for this doctor
                reviewsReceived: {
                    select: { rating: true },
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

                // Compute average rating & total reviews
                const totalReviews = u.reviewsReceived.length;
                const avgRating =
                    totalReviews > 0
                        ? u.reviewsReceived.reduce((sum, r) => sum + r.rating, 0) / totalReviews
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
                        noShow: u.doctor.noShowPolicy,
                        reschedule: u.doctor.reschedulePolicy,
                    },
                    pricing: u.doctor.pricing,
                    availability: adjustedAvailability,
                    availableSlots: filteredSlots,
                    totalReviews,
                    avgRating,
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

        if (!slotId || !serviceType) {
            return res.status(400).json({ error: "slotId and serviceType are required" });
        }

        // Get patient info
        const user = await prisma.user.findUnique({
            where: { id: patientUserId },
            select: {
                id: true,
                fullName: true,
                email: true,
                patient: { select: { id: true, country: true, phone: true } },
            },
        });

        if (!user?.patient) return res.status(404).json({ error: "Patient not found" });
        const patient = user.patient;

        // Transaction: reserve slot and create appointment
        const { appointment, slot, pricing, currency } = await prisma.$transaction(async (tx) => {
            const slot = await tx.doctorSlot.findUnique({
                where: { id: slotId },
                include: { doctor: { include: { pricing: true } } },
            });

            if (!slot) throw new Error("Slot not found");
            if (slot.status !== "AVAILABLE") throw new Error("Slot already reserved");

            // Determine currency based on patient country
            let currency = "USD";
            const country = patient.country?.toLowerCase();
            if (country === "egypt") currency = "EGP";
            else if (country === "saudi arabia") currency = "SAR";
            else if (country === "uae") currency = "AED";

            // Get pricing for selected service & currency
            const pricing = slot.doctor.pricing.find(
                (p) => p.service === serviceType && p.currency === currency
            );

            if (!pricing) throw new Error(`Service ${serviceType} not available in ${currency}`);

            // Reserve slot
            const updatedSlot = await tx.doctorSlot.update({
                where: { id: slotId },
                data: { status: "RESERVED" },
            });

            // Create appointment
            const appointment = await tx.appointment.create({
                data: {
                    doctorId: slot.doctorId,
                    patientId: patient.id,
                    appointmentType: serviceType,
                    date: slot.startTime
                },
            });

            return { appointment, slot: updatedSlot, pricing, currency };
        });

        // Convert amount to EGP if needed
        let amount = pricing.price;
        if (currency !== "EGP") {
            if (!convertToEGP) throw new Error("convertToEGP function is not defined");
            amount = await convertToEGP(pricing.price, currency);
        }

        // Create payment record
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

        // PayMob: get auth token & payment token
        const authToken = await paymobService.getAuthToken();
        const uniqueMerchantId = `PAY-${payment.id}-${Date.now()}`;

        const orderId = await paymobService.createOrder(authToken, amount, "EGP", uniqueMerchantId);

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

        const IFRAME_ID = process.env.PAYMOB_IFRAME_ID;
        const redirectUrl = `https://accept.paymob.com/api/acceptance/iframes/${IFRAME_ID}?payment_token=${paymentToken}`;

        await prisma.payment.update({
            where: { id: payment.id },
            data: { paymentUrl: redirectUrl },
        });

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
                    include: {
                        department: true,
                    }

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
                        department: true
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
                    userId:doc.user.id,
                    id: doc.id,
                    avatarUrl: doc.avatarUrl,
                    fullName: doc.user.fullName,
                    email: doc.user.email,
                    department: doc.department?.name || null
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
        const patientUserId = req.user.id;
        const file = req.file;
        const { type, notes } = req.body;

        if (!file) return res.status(400).json({ error: "File is required" });

        const patient = await prisma.patient.findUnique({
            where: { userId: patientUserId },
        });

        if (!patient) return res.status(404).json({ error: "Patient not found" });

        const record = await prisma.medicalRecord.create({
            data: {
                patientId: patient.id,
                type,
                fileUrl: `/uploads/${file.filename}`,
                notes,
            },
        });

        res.json({ message: "Medical record uploaded", record });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Server error" });
    }
};

// =========================
// Get All Medical Records
// =========================
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
// Edit Medical Record
// =========================
exports.editMedicalRecord = async (req, res) => {
    try {
        const patientUserId = req.user.id;
        const recordId = parseInt(req.params.id);
        const { type, notes } = req.body;
        const file = req.file;

        const record = await prisma.medicalRecord.findUnique({
            where: { id: recordId },
            include: { patient: true },
        });

        if (!record) return res.status(404).json({ error: "Record not found" });
        if (record.patient.userId !== patientUserId)
            return res.status(403).json({ error: "Not authorized" });

        let updatedData = { type, notes };

        // If new file uploaded, delete old one + update URL
        if (file) {
            const oldPath = path.join(__dirname, "..", record.fileUrl);
            if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
            updatedData.fileUrl = `/uploads/${file.filename}`;
        }

        const updated = await prisma.medicalRecord.update({
            where: { id: recordId },
            data: updatedData,
        });

        res.json({ message: "Medical record updated", updated });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Server error" });
    }
};

// =========================
// Delete Medical Record
// =========================
exports.deleteMedicalRecord = async (req, res) => {
    try {
        const patientUserId = req.user.id;
        const recordId = parseInt(req.params.id);

        const record = await prisma.medicalRecord.findUnique({
            where: { id: recordId },
            include: { patient: true },
        });

        if (!record) return res.status(404).json({ error: "Record not found" });
        if (record.patient.userId !== patientUserId)
            return res.status(403).json({ error: "Not authorized" });

        // Delete file if exists
        const filePath = path.join(__dirname, "..", record.fileUrl);
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);

        await prisma.medicalRecord.delete({ where: { id: recordId } });

        res.json({ message: "Medical record deleted" });
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
// Cancel a reserved slot (with debug logs)
// =========================
exports.cancelReservation = async (req, res) => {
    try {
        const patientUserId = req.user?.id;
        const { appointmentId } = req.body;

        if (!appointmentId) {
            return res.status(400).json({ error: 'appointmentId is required' });
        }

        const user = await prisma.user.findUnique({
            where: { id: patientUserId },
            include: { patient: true },
        });

        if (!user?.patient) {
            return res.status(404).json({ error: 'Patient not found' });
        }

        const appointment = await prisma.appointment.findUnique({
            where: { id: appointmentId },
            include: {
                doctor: { include: { user: true } },
                Payment: true,
            },
        });

        if (!appointment) {
            return res.status(404).json({ error: 'Appointment not found' });
        }

        if (appointment.patientId !== user.patient.id) {
            return res.status(403).json({ error: 'This appointment does not belong to you' });
        }

        if (['PENDING_PAYMENT', 'CANCELLED', 'COMPLETED', 'NO_SHOW'].includes(appointment.status)) {
            return res.status(400).json({ error: 'This appointment cannot be cancelled' });
        }

        const now = new Date();
        const appointmentTime = new Date(appointment.date);
        const diffHours = (appointmentTime - now) / (1000 * 60 * 60);
        const canRefund = diffHours >= appointment.doctor.cancellationPolicy;

        let refundSuccess = false;

        await prisma.$transaction(async (tx) => {

            await tx.appointment.update({
                where: { id: appointmentId },
                data: { status: 'CANCELLED' },
            });

            // Free the doctor slot
            await tx.doctorSlot.updateMany({
                where: { doctorId: appointment.doctorId, startTime: appointment.date },
                data: { status: 'AVAILABLE' },
            });

        });

        // ------------------------
        // Refund outside transaction
        // ------------------------
        if (canRefund && appointment.Payment) {
            try {
                await paymobService.refundPaymentThroughPaymob(
                    appointment.Payment.paymobTransactionId
                );

                await prisma.payment.update({
                    where: { id: appointment.Payment.id },
                    data: { status: 'REFUNDED' },
                });

                refundSuccess = true;
            } catch (refundErr) {
                console.error('❌ Refund failed:', refundErr);
            }
        }

        // ===============================
        // 🔔 Notifications & Emails
        // ===============================
        // Notify doctor
        await pushNotification({
            userId: appointment.doctor.user.id,
            type: 'APPOINTMENT',
            title: 'Appointment Cancelled',
            message: `The appointment with ${user.fullName} on ${new Date(
                appointment.date
            ).toLocaleString()} has been cancelled.`,
            redirectUrl: `/doctor/appointments/${appointment.id}`,
            metadata: { appointmentId: appointment.id, patientId: user.patient.id },
            email: appointment.doctor.user.email,
        });

        // Notify patient
        await pushNotification({
            userId: patientUserId,
            type: 'APPOINTMENT',
            title: 'Appointment Cancelled',
            message: `Your appointment with Dr. ${appointment.doctor.user.fullName} has been cancelled.`,
            redirectUrl: `/patient/appointments/${appointment.id}`,
            metadata: { appointmentId: appointment.id, doctorId: appointment.doctorId },
            email: user.email,
        });

        // Notify refund if applicable
        if (refundSuccess) {
            await pushNotification({
                userId: patientUserId,
                type: 'PAYMENT',
                title: 'Refund Processed',
                message: `Your payment for the cancelled appointment with Dr. ${appointment.doctor.user.fullName} has been refunded.`,
                redirectUrl: `/patient/payments/${appointment.Payment.id}`,
                metadata: { paymentId: appointment.Payment.id },
                email: user.email,
            });
        }

        res.json({
            message: canRefund
                ? 'Appointment cancelled successfully and refund processed'
                : 'Appointment cancelled successfully (no refund due to policy)',
        });
    } catch (err) {
        console.error('🔥 cancelReservation error:', err);
        res.status(500).json({ error: 'Server error' });
    }
};

// =========================
// Reschedule Appointment
// =========================
exports.rescheduleAppointment = async (req, res) => {
    try {
        const { appointmentId, newSlotId } = req.body;
        const userId = req.user.id;

        const appointment = await prisma.appointment.findUnique({
            where: { id: appointmentId },
            include: {
                doctor: { include: { user: true } },
                patient: { include: { user: true } },
            },
        });

        if (!appointment)
            return res.status(404).json({ error: 'Appointment not found' });
        if (appointment.status !== 'CONFIRMED')
            return res
                .status(400)
                .json({ error: 'Only confirmed appointments can be rescheduled' });

        const patient = await prisma.patient.findUnique({ where: { userId } });
        if (appointment.patientId !== patient.id)
            return res
                .status(403)
                .json({ error: 'You cannot reschedule this appointment' });

        const doctor = appointment.doctor;
        const policyHours = doctor.reschedulePolicy || 0;
        const now = new Date();
        const timeUntilAppointment =
            (appointment.date - now) / (1000 * 60 * 60);

        if (timeUntilAppointment < policyHours) {
            return res.status(400).json({
                error: `Cannot reschedule less than ${policyHours} hours before appointment`,
            });
        }

        const newSlot = await prisma.doctorSlot.findUnique({
            where: { id: newSlotId },
            include: { doctor: true },
        });

        if (!newSlot)
            return res.status(404).json({ error: 'New slot not found' });
        if (newSlot.doctorId !== appointment.doctorId)
            return res
                .status(400)
                .json({ error: 'Slot must belong to the same doctor' });
        if (newSlot.isBooked)
            return res.status(400).json({ error: 'Slot is already booked' });
        if (newSlot.startTime < new Date())
            return res.status(400).json({ error: 'Cannot reschedule to a past slot' });

        await prisma.doctorSlot.updateMany({
            where: { startTime: appointment.date },
            data: { status: "AVAILABLE" },
        });

        await prisma.$transaction([
            prisma.appointment.update({
                where: { id: appointmentId },
                data: {
                    date: newSlot.startTime,
                    status: 'CONFIRMED',
                },
            }),
            prisma.doctorSlot.update({
                where: { id: newSlot.id },
                data: { status: "RESERVED" },
            })
        ]);

        res.json({ message: 'Appointment rescheduled successfully' });

        // 🔔 Notify doctor
        await pushNotification({
            userId: doctor.user.id,
            type: 'APPOINTMENT',
            title: 'Appointment Rescheduled',
            message: `${appointment.patient.user.fullName} rescheduled their appointment to ${new Date(
                newSlot.startTime
            ).toLocaleString()}.`,
            redirectUrl: `/doctor/appointments/${appointmentId}`,
            metadata: { appointmentId, newSlotId },
            email: doctor.user.email,
        });

        // 🔔 Notify patient
        await pushNotification({
            userId: patient.userId,
            type: 'APPOINTMENT',
            title: 'Appointment Rescheduled',
            message: `Your appointment with Dr. ${doctor.user.fullName} was rescheduled to ${new Date(
                newSlot.startTime
            ).toLocaleString()}.`,
            redirectUrl: `/patient/appointments/${appointmentId}`,
            metadata: { appointmentId, newSlotId },
            email: appointment.patient.user.email,
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Server error' });
    }
};


exports.reviewDoctor = async (req, res) => {
    try {
        const patientUserId = req.user.id; // from auth middleware
        const { doctorId, rating, comment } = req.body;

        if (!doctorId || !rating)
            return res.status(400).json({ error: "doctorId and rating are required" });

        if (rating < 1 || rating > 5)
            return res.status(400).json({ error: "Rating must be between 1 and 5" });

        // Get patient
        const patient = await prisma.patient.findUnique({
            where: { userId: patientUserId },
        });

        if (!patient) return res.status(404).json({ error: "Patient not found" });

        // Check if doctor exists
        const doctor = await prisma.doctor.findUnique({ where: { id: doctorId } });
        if (!doctor) return res.status(404).json({ error: "Doctor not found" });

        // Optional: prevent multiple reviews from same patient
        const existingReview = await prisma.review.findFirst({
            where: { reviewerId: patientUserId, revieweeId: doctor.userId },
        });
        if (existingReview)
            return res.status(400).json({ error: "You have already reviewed this doctor" });

        // Create review
        const review = await prisma.review.create({
            data: {
                reviewerId: patientUserId,
                revieweeId: doctor.userId,
                rating,
                comment,
            },
            select: {
                id: true,
                rating: true,
                comment: true,
                createdAt: true,
                reviewer: { select: { fullName: true } },
            },
        });

        res.json({ message: "Review submitted successfully", review });
    } catch (err) {
        console.error("reviewDoctor error:", err);
        res.status(500).json({ error: "Server error" });
    }
};

exports.updateDoctorReview = async (req, res) => {
    try {
        const { reviewId, rating, comment } = req.body;
        const userId = req.user.id; // from auth middleware

        if (!reviewId) {
            return res.status(400).json({ error: "reviewId is required" });
        }

        // Find the review
        const review = await prisma.review.findUnique({
            where: { id: reviewId },
        });

        if (!review) {
            return res.status(404).json({ error: "Review not found" });
        }

        // Ensure the current user is the reviewer
        if (review.reviewerId !== userId) {
            return res.status(403).json({ error: "You can only update your own review" });
        }

        // Update the review
        const updatedReview = await prisma.review.update({
            where: { id: reviewId },
            data: {
                rating: rating ?? review.rating,
                comment: comment ?? review.comment,
            },
        });

        res.json({ message: "Review updated successfully", review: updatedReview });
    } catch (err) {
        console.error("updateDoctorReview error:", err);
        res.status(500).json({ error: "Server error" });
    }
};

exports.getDoctorById = async (req, res) => {
    try {
        const doctorId = parseInt(req.params.id);
        if (!doctorId) return res.status(400).json({ error: "Doctor ID is required" });

        const userId = req.user.id;

        // Get patient's country for currency
        const patient = await prisma.user.findUnique({
            where: { id: parseInt(userId) },
            select: { patient: { select: { country: true } } },
        });

        if (!patient || !patient.patient)
            return res.status(404).json({ error: "Patient not found" });

        const country = patient.patient.country;
        let currency = "USD";
        if (country.toLowerCase() === "egypt") currency = "EGP";
        else if (country.toLowerCase() === "saudi arabia") currency = "SAR";
        else if (country.toLowerCase() === "uae") currency = "AED";

        // Fetch doctor by doctor.id
        const doctor = await prisma.doctor.findUnique({
            where: { userId: doctorId }, // <-- use userId instead of id
            include: {
                user: {
                    select: {
                        id: true,
                        fullName: true,
                        email: true,
                        reviewsReceived: {
                            select: {
                                id: true,
                                rating: true,
                                comment: true,
                                createdAt: true,
                                reviewer: { select: { id: true, fullName: true } },
                            },
                            orderBy: { createdAt: "desc" },
                        },
                    }
                },
                department: { select: { name: true } },
                pricing: { where: { currency }, select: { service: true, price: true } },
                availability: true,
                DoctorSlot: {
                    where: { status: "AVAILABLE" },
                    select: {
                        id: true,
                        date: true,
                        startTime: true,
                        endTime: true,
                        chat: true,
                        voice: true,
                        video: true,
                        notes: true,
                    },
                },
            },
        });

        if (!doctor)
            return res.status(404).json({ error: "Doctor not found" });

        // Filter & format slots
        const availableServices = doctor.pricing.map((p) => p.service);

        const filteredSlots = doctor.DoctorSlot.map((slot) => ({
            ...slot,
            chat: slot.chat && availableServices.includes("CHAT"),
            voice: slot.voice && availableServices.includes("VOICE"),
            video: slot.video && availableServices.includes("VIDEO"),
        })).filter((slot) => slot.chat || slot.voice || slot.video);

        const adjustedAvailability = doctor.availability
            ? {
                chat: doctor.availability.chat && availableServices.includes("CHAT"),
                voice: doctor.availability.voice && availableServices.includes("VOICE"),
                video: doctor.availability.video && availableServices.includes("VIDEO"),
            }
            : null;

        const totalReviews = doctor.user.reviewsReceived.length;
        const avgRating =
            totalReviews > 0
                ? doctor.user.reviewsReceived.reduce((sum, r) => sum + r.rating, 0) / totalReviews
                : null;

        const formatted = {
            userId: doctor.user.id,
            id: doctor.id,
            fullName: doctor.user.fullName,
            email: doctor.user.email,
            title: doctor.title,
            bio: doctor.bio,
            phone: doctor.phone,
            avatarUrl: doctor.avatarUrl,
            languages: doctor.languages,
            department: doctor.department?.name,
            policies: {
                cancellation: doctor.cancellationPolicy,
                noShow: doctor.noShowPolicy,
                reschedule: doctor.reschedulePolicy,
            },
            pricing: doctor.pricing,
            availability: adjustedAvailability,
            availableSlots: filteredSlots,
            totalReviews,
            avgRating,
            reviews: doctor.user.reviewsReceived.map((r) => ({
                id: r.id,
                rating: r.rating,
                comment: r.comment,
                createdAt: r.createdAt,
                reviewer: r.reviewer,
            })),
        };

        res.json({ doctor: formatted });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Server error" });
    }
};
