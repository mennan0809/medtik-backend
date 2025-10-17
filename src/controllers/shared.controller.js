// controllers/department.controller.js
const prisma = require("../config/db");
const {Role} = require("@prisma/client");
const jwt = require("jsonwebtoken");
const JWT_SECRET = process.env.JWT_SECRET;

exports.getDepartments = async (req, res) => {
    try {
        const departments = await prisma.department.findMany({
            include: {
                doctors: {
                    include: {
                        user: true,
                        Appointment: true, // 👈 include appointments to count them
                    },
                },
            },
        });

        const formatted = departments.map((dep) => ({
            id: dep.id,
            name: dep.name,
            description: dep.description,
            doctors: dep.doctors.map((doc) => ({
                id: doc.user.id,
                doctorId: doc.id,
                name: doc.user?.fullName || "Unknown Doctor",
                email: doc.user?.email || "N/A",
                status: doc.user?.status?.toLowerCase() || "inactive",
                sessions: doc.Appointment?.length || 0, // 👈 session count
                rating: null, // placeholder if you’ll add ratings later
            })),
        }));

        res.json(formatted);
    } catch (error) {
        console.error("Error fetching departments:", error);
        res.status(500).json({ error: "Failed to fetch departments" });
    }
};

// Get single department by ID
exports.getDepartmentById = async (req, res) => {
    try {
        const { id } = req.params;
        const department = await prisma.department.findUnique({
            where: { id: parseInt(id) }
        });

        if (!department) {
            return res.status(404).json({ error: "Department not found" });
        }

        res.json(department);
    } catch (error) {
        console.error("Error fetching department:", error);
        res.status(500).json({ error: "Failed to fetch department" });
    }
};

exports.getAppointments = async (req, res) => {
    try {
        const user = req.user;
        let appointments;

        const includeSlim = {
            doctor: {
                select: {
                    id: true,
                    title: true,
                    phone: true,
                    user: { select: { fullName: true } },
                    department: { select: { name: true } },
                    avatarUrl: true,
                },
            },
            patient: {
                select: {
                    id: true,
                    phone: true,
                    country: true,
                    user: { select: { fullName: true } },
                },
            },
        };

        if (user.role === Role.DOCTOR) {
            const doctor = await prisma.doctor.findUnique({ where: { userId: user.id } });
            if (!doctor) return res.status(404).json({ error: "Doctor profile not found" });

            appointments = await prisma.appointment.findMany({
                where: { doctorId: doctor.id },
                include: includeSlim,
                orderBy: { date: "desc" },
            });

        } else if (user.role === Role.PATIENT) {
            const patient = await prisma.patient.findUnique({ where: { userId: user.id } });
            if (!patient) return res.status(404).json({ error: "Patient profile not found" });

            appointments = await prisma.appointment.findMany({
                where: { patientId: patient.id },
                include: includeSlim,
                orderBy: { date: "desc" },
            });

        } else if (user.role === Role.ADMIN) {
            appointments = await prisma.appointment.findMany({
                include: includeSlim,
                orderBy: { date: "desc" },
            });
        } else {
            return res.status(403).json({ error: "Unauthorized role" });
        }

        // Slim down each appointment object
        const mapped = appointments.map(a => ({
            id: a.id,
            doctorId: a.doctorId,
            patientId: a.patientId,
            date: a.date,
            appointmentType: a.appointmentType,
            status: a.status,
            doctor: {
                id: a.doctor.id,
                title: a.doctor.title,
                phone: a.doctor.phone,
                fullName: a.doctor.user.fullName,
                department: a.doctor.department?.name || 'Unknown',
                avatarUrl: a.doctor.avatarUrl,
            },
            patient: {
                id: a.patient.id,
                phone: a.patient.phone,
                country: a.patient.country,
                fullName: a.patient.user.fullName,
            },
        }));

        res.json(mapped);
    } catch (error) {
        console.error("Error fetching appointments:", error);
        res.status(500).json({ error: "Failed to fetch appointments" });
    }
};

exports.getPayments = async (req, res) => {
    try {
        const user = req.user;
        let payments;

        const userSelect = {
            select: { fullName: true, id: true } // include other fields if needed
        };

        if (user.role === Role.DOCTOR) {
            const doctor = await prisma.doctor.findUnique({
                where: { userId: user.id },
            });

            if (!doctor) return res.status(404).json({ error: "Doctor profile not found" });

            payments = await prisma.payment.findMany({
                where: { doctorId: doctor.id },
                include: {
                    doctor: {
                        include: { user: userSelect },
                    },
                    patient: {
                        include: { user: userSelect },
                    },
                    appointment: true,
                },
                orderBy: { createdAt: "desc" },
            });
        } else if (user.role === Role.PATIENT) {
            const patient = await prisma.patient.findUnique({
                where: { userId: user.id },
            });

            if (!patient) return res.status(404).json({ error: "Patient profile not found" });

            payments = await prisma.payment.findMany({
                where: { patientId: patient.id },
                include: {
                    doctor: {
                        include: { user: userSelect },
                    },
                    patient: {
                        include: { user: userSelect },
                    },
                    appointment: true,
                },
                orderBy: { createdAt: "desc" },
            });
        } else if (user.role === Role.ADMIN) {
            payments = await prisma.payment.findMany({
                include: {
                    doctor: {
                        include: { user: userSelect },
                    },
                    patient: {
                        include: { user: userSelect },
                    },
                    appointment: true,
                },
                orderBy: { createdAt: "desc" },
            });
        } else {
            return res.status(403).json({ error: "Unauthorized role" });
        }

        res.json(payments);
    } catch (error) {
        console.error("Error fetching payments:", error);
        res.status(500).json({ error: "Failed to fetch payments" });
    }
};

exports.getMyReviews = async (req, res) => {
    try {
        // Get user from token
        const authHeader = req.headers.authorization;
        if (!authHeader?.startsWith("Bearer "))
            return res.status(401).json({ error: "No token" });

        const token = authHeader.split(" ")[1];
        const decoded = jwt.verify(token, JWT_SECRET);
        const userId = decoded.id;

        // Fetch reviews for this user
        const reviews = await prisma.review.findMany({
            where: { revieweeId: userId },
            select: {
                rating: true,
                comment: true,
                createdAt: true,
                reviewer: {
                    select: { fullName: true },
                },
            },
            orderBy: { createdAt: "desc" },
        });

        // Calculate rating stats
        const totalReviews = reviews.length;
        const ratingCounts = { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 };
        let ratingSum = 0;

        reviews.forEach(r => {
            ratingSum += r.rating;
            ratingCounts[r.rating] = (ratingCounts[r.rating] || 0) + 1;
        });

        const avgRating = totalReviews ? (ratingSum / totalReviews).toFixed(1) : 0;

        res.json({
            totalReviews,
            avgRating: Number(avgRating),
            ratingCounts,
            reviews: reviews.map(r => ({
                comment: r.comment,
                rating: r.rating,
                reviewerName: r.reviewer.fullName,
                createdAt: r.createdAt,
            })),
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Server error" });
    }
};

exports.getMyWrittenReviews = async (req, res) => {
    try {
        // Get user from token
        const authHeader = req.headers.authorization;
        if (!authHeader?.startsWith("Bearer "))
            return res.status(401).json({ error: "No token" });

        const token = authHeader.split(" ")[1];
        const decoded = jwt.verify(token, JWT_SECRET);
        const userId = decoded.id;

        // Fetch reviews written by this user
        const reviews = await prisma.review.findMany({
            where: { reviewerId: userId },
            select: {
                rating: true,
                comment: true,
                createdAt: true,
                reviewee: {
                    select: {
                        fullName: true,
                        role: true,
                        doctor: { select: { avatarUrl:true, title: true, departmentId: true } },
                        patient: { select: { gender: true, country: true } },
                    },
                },
            },
            orderBy: { createdAt: "desc" },
        });

        // Calculate rating stats for your own reviews
        const totalReviews = reviews.length;
        const ratingCounts = { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 };
        let ratingSum = 0;

        reviews.forEach(r => {
            ratingSum += r.rating;
            ratingCounts[r.rating] = (ratingCounts[r.rating] || 0) + 1;
        });

        const avgRating = totalReviews ? (ratingSum / totalReviews).toFixed(1) : 0;

        res.json({
            totalReviews,
            avgRating: Number(avgRating),
            ratingCounts,
            reviews: reviews.map(r => ({
                avatarUrl: r.reviewee?.doctor?.avatarUrl || '', // fixed
                title: r.reviewee?.doctor?.title || '',
                comment: r.comment,
                rating: r.rating,
                revieweeName: r.reviewee.fullName,
                createdAt: r.createdAt,
            })),
        });

    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Server error" });
    }
};
