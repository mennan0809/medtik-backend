const prisma = require('../config/db');

// Get all notifications (unread first)
exports.getNotifications = async (req, res) => {
    try {
        const userId = req.user.id;
        const role = req.user.role;

        let notifications;

        if (role === "ADMIN") {
            // 🧠 Admin gets global admin notifications
            notifications = await prisma.adminNotification.findMany({
                orderBy: [{ read: "asc" }, { createdAt: "desc" }],
            });
        } else {
            // 👤 Regular user gets their personal notifications
            notifications = await prisma.notification.findMany({
                where: { userId },
                orderBy: [{ read: "asc" }, { createdAt: "desc" }],
            });
        }

        res.json({ notifications });
    } catch (err) {
        console.error("❌ Get notifications error:", err);
        res.status(500).json({ error: "Failed to fetch notifications" });
    }
};


// Mark a notification as read
// =========================
// Mark Notification as Read (User/Admin)
// =========================
exports.markAsRead = async (req, res) => {
    try {
        const userId = req.user.id;
        const role = req.user.role;
        const { id } = req.params;

        if (role === "ADMIN") {
            // 🧠 Mark admin notification as read
            await prisma.adminNotification.updateMany({
                where: { id: Number(id) },
                data: { read: true },
            });
        } else {
            // 👤 Mark user notification as read
            await prisma.notification.updateMany({
                where: { id: Number(id), userId },
                data: { read: true },
            });
        }

        res.json({ success: true });
    } catch (err) {
        console.error("❌ Mark as read error:", err);
        res.status(500).json({ error: "Failed to mark as read" });
    }
};

