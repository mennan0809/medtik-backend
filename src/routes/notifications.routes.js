const express = require('express');
const router = express.Router();
const { getNotifications, markAsRead, markAsUnread, deleteNotification, markAllAsRead, deleteAllNotifications} = require('../controllers/notifications.controller');
const { verifyToken } = require("../middleware/auth");

router.get('/', verifyToken, getNotifications);
router.patch('/:id/read', verifyToken, markAsRead);
router.patch('/readAll', verifyToken, markAllAsRead);
router.patch('/:id/unread', verifyToken, markAsUnread);
router.delete('/deleteAll', verifyToken, deleteAllNotifications);
router.delete('/:id', verifyToken, deleteNotification);


module.exports = router;
