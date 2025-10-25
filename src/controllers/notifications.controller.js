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

// =========================
// Mark ALL Notifications as Read (User/Admin)
// =========================
exports.markAllAsRead = async (req, res) => {
    try {
        const userId = req.user.id;
        const role = req.user.role;

        let result;

        if (role === "ADMIN") {
            // 🧠 Mark all admin notifications as read
            result = await prisma.adminNotification.updateMany({
                where: { read: false },
                data: { read: true },
            });
        } else {
            // 👤 Mark all user notifications as read
            result = await prisma.notification.updateMany({
                where: { userId, read: false },
                data: { read: true },
            });
        }

        res.json({
            success: true,
            message: `✅ ${result.count} notifications marked as read.`,
        });
    } catch (err) {
        console.error("❌ Mark all as read error:", err);
        res.status(500).json({ error: "Failed to mark all as read" });
    }
};
// =========================
// Mark Notification as Unread (User/Admin)
// =========================
exports.markAsUnread = async (req, res) => {
    try {
        const userId = req.user.id;
        const role = req.user.role;
        const { id } = req.params;

        if (role === "ADMIN") {
            // 🧠 Mark admin notification as unread
            await prisma.adminNotification.updateMany({
                where: { id: Number(id) },
                data: { read: false },
            });
        } else {
            // 👤 Mark user notification as unread
            await prisma.notification.updateMany({
                where: { id: Number(id), userId },
                data: { read: false },
            });
        }

        res.json({ success: true });
    } catch (err) {
        console.error("❌ Mark as unread error:", err);
        res.status(500).json({ error: "Failed to mark as unread" });
    }
};

// =========================
// Delete Notification (User/Admin)
// =========================
exports.deleteNotification = async (req, res) => {
    try {
        const userId = req.user.id;
        const role = req.user.role;
        const { id } = req.params;

        if (role === "ADMIN") {
            // 🧠 Delete admin notification
            await prisma.adminNotification.deleteMany({
                where: { id: Number(id) },
            });
        } else {
            // 👤 Delete user notification
            await prisma.notification.deleteMany({
                where: { id: Number(id), userId },
            });
        }

        res.json({ success: true });
    } catch (err) {
        console.error("❌ Delete notification error:", err);
        res.status(500).json({ error: "Failed to delete notification" });
    }
};

// =========================
// Delete ALL Notifications (User/Admin)
// =========================
exports.deleteAllNotifications = async (req, res) => {
    try {
        const userId = req.user.id;
        const role = req.user.role;

        let result;

        if (role === "ADMIN") {
            // 🧠 Delete all admin notifications
            result = await prisma.adminNotification.deleteMany({});
        } else {
            // 👤 Delete all notifications for this user
            result = await prisma.notification.deleteMany({
                where: { userId },
            });
        }

        res.json({
            success: true,
            message: `🗑️ ${result.count} notifications deleted.`,
        });
    } catch (err) {
        console.error("❌ Delete all notifications error:", err);
        res.status(500).json({ error: "Failed to delete all notifications" });
    }
};
