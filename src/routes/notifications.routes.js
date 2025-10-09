const express = require('express');
const router = express.Router();
const { getNotifications, markAsRead } = require('../controllers/notifications.controller');
const { verifyToken } = require("../middleware/auth");

router.get('/', verifyToken, getNotifications);
router.patch('/:id/read', verifyToken, markAsRead);

module.exports = router;
