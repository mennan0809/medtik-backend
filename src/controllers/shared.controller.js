// controllers/department.controller.js
const prisma = require("../config/db");
const {Role} = require("@prisma/client");

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

        if (user.role === Role.DOCTOR) {
            // find the linked doctor first
            const doctor = await prisma.doctor.findUnique({
                where: { userId: user.id },
            });

            if (!doctor) {
                return res.status(404).json({ error: "Doctor profile not found" });
            }

            appointments = await prisma.appointment.findMany({
                where: { doctorId: doctor.id },
                include: {
                    doctor: true,
                    patient: true,
                    department: true,
                },
                orderBy: { date: "desc" },
            });
        } else if (user.role === Role.PATIENT) {
            // find the linked patient first
            const patient = await prisma.patient.findUnique({
                where: { userId: user.id },
            });

            if (!patient) {
                return res.status(404).json({ error: "Patient profile not found" });
            }

            appointments = await prisma.appointment.findMany({
                where: { patientId: patient.id },
                include: {
                    doctor: true,
                    patient: true,
                    department: true,
                },
                orderBy: { date: "desc" },
            });
        } else if (user.role === Role.ADMIN) {
            // Admin gets all appointments
            appointments = await prisma.appointment.findMany({
                include: {
                    doctor: true,
                    patient: true,
                    department: true,
                },
                orderBy: { date: "desc" },
            });
        } else {
            return res.status(403).json({ error: "Unauthorized role" });
        }

        res.json(appointments);
    } catch (error) {
        console.error("Error fetching appointments:", error);
        res.status(500).json({ error: "Failed to fetch appointments" });
    }
};
exports.getPayments = async (req, res) => {
    try {
        const user = req.user;
        let payments;

        if (user.role === Role.DOCTOR) {
            // find doctor linked to user
            const doctor = await prisma.doctor.findUnique({
                where: { userId: user.id },
            });

            if (!doctor) {
                return res.status(404).json({ error: "Doctor profile not found" });
            }

            payments = await prisma.payment.findMany({
                where: { doctorId: doctor.id },
                include: {
                    doctor: true,
                    patient: true,
                    appointment: true,
                },
                orderBy: { createdAt: "desc" },
            });
        } else if (user.role === Role.PATIENT) {
            // find patient linked to user
            const patient = await prisma.patient.findUnique({
                where: { userId: user.id },
            });

            if (!patient) {
                return res.status(404).json({ error: "Patient profile not found" });
            }

            payments = await prisma.payment.findMany({
                where: { patientId: patient.id },
                include: {
                    doctor: true,
                    patient: true,
                    appointment: true,
                },
                orderBy: { createdAt: "desc" },
            });
        } else if (user.role === Role.ADMIN) {
            // Admin gets everything
            payments = await prisma.payment.findMany({
                include: {
                    doctor: true,
                    patient: true,
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