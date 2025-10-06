// controllers/department.controller.js
const prisma = require("../config/db");
const {Role} = require("@prisma/client");

// Get all departments
exports.getDepartments = async (req, res) => {
    try {
        const departments = await prisma.department.findMany();
        res.json(departments);
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

exports.getTransactions = async (req, res) => {
    try {
        const user = req.user;

        let transactions;

        if (user.role === Role.ADMIN) {
            transactions = await prisma.transaction.findMany({
                include: {
                    doctor: true,
                    patient: true,
                },
            });
        } else if (user.role === Role.DOCTOR) {
            transactions = await prisma.transaction.findMany({
                where: { doctorId: user.id },
                include: {
                    doctor: true,
                    patient: true,
                },
            });
        } else if (user.role === Role.PATIENT) {
            transactions = await prisma.transaction.findMany({
                where: { patientId: user.id },
                include: {
                    doctor: true,
                    patient: true,
                },
            });
        } else {
            return res.status(403).json({ error: "Unauthorized role" });
        }

        res.json(transactions);
    } catch (error) {
        console.error("Error fetching transactions:", error);
        res.status(500).json({ error: "Failed to fetch transactions" });
    }
};
