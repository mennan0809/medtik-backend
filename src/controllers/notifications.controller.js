const prisma = require('../config/db');

// Get all notifications (unread first)
exports.getNotifications = async (req, res) => {
    try {
        const userId = req.user.id;
        const notifications = await prisma.notification.findMany({
            where: { userId },
            orderBy: [{ read: 'asc' }, { createdAt: 'desc' }],
        });
        res.json({ notifications });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to fetch notifications' });
    }
};

// Mark a notification as read
exports.markAsRead = async (req, res) => {
    try {
        const userId = req.user.id;
        const { id } = req.params;
        await prisma.notification.updateMany({
            where: { id: Number(id), userId },
            data: { read: true },
        });
        res.json({ success: true });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to mark as read' });
    }
};
