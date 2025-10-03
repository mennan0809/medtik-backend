const prisma = require("../../config/db");

// ===========================
// Add Department
// ===========================
exports.addDepartment = async (req, res) => {
    try {
        const { name, description } = req.body;

        if (!name) {
            return res.status(400).json({ error: "Department name is required" });
        }

        const department = await prisma.department.create({
            data: {
                name: name.toLowerCase(),
                description
            }
        });

        res.status(201).json({
            message: "Department created successfully",
            department
        });
    } catch (err) {
        console.error("Add department error:", err);
        if (err.code === "P2002") {
            return res.status(400).json({ error: "Department name must be unique" });
        }
        res.status(500).json({ error: "Failed to create department" });
    }
};

// ===========================
// Get All Users
// ===========================
exports.getUsers = async (req, res) => {
    try {
        const users = await prisma.user.findMany({
            select: {
                fullName: true,
                email: true,
                role: true,
                createdAt: true,
                status: true,
                patient: { select: { phone: true } },
                doctor: { select: { phone: true } }
            },
            orderBy: { createdAt: "desc" }
        });

        const result = users.map(u => ({
            id: u.id,
            name: u.fullName,
            email: u.email,
            role: u.role,
            joined: u.createdAt,
            phoneNumber: u.patient?.phone || u.doctor?.phone || null,
            status: u.status
        }));

        res.json(result);
    } catch (err) {
        console.error("Get users error:", err);
        res.status(500).json({ error: "Failed to fetch users" });
    }
};
// ===========================
// Ban / Unban User
// ===========================
exports.toggleBanUser = async (req, res) => {
    try {
        const { email } = req.body;
        const adminId = req.user.id; // from middleware verifyToken

        if (!email) {
            return res.status(400).json({ error: "Email is required" });
        }

        // find user by email
        const user = await prisma.user.findUnique({ where: { email } });

        if (!user) {
            return res.status(404).json({ error: "User not found" });
        }

        // prevent banning yourself (admin credentials)
        if (user.id === adminId) {
            return res.status(403).json({ error: "You cannot ban/unban your own account" });
        }

        // toggle status
        const newStatus = user.status === "ACTIVE" ? "BANNED" : "ACTIVE";

        const updatedUser = await prisma.user.update({
            where: { email },
            data: { status: newStatus },
            select: {
                id: true,
                fullName: true,
                email: true,
                role: true,
                status: true,
                createdAt: true
            }
        });

        res.json({
            message: `User ${newStatus === "BANNED" ? "banned" : "unbanned"} successfully`,
            user: updatedUser
        });
    } catch (err) {
        console.error("Toggle ban user error:", err);
        res.status(500).json({ error: "Failed to update user status" });
    }
};