// admin.routes.js
const express = require('express');
const router = express.Router();
const adminController = require('../controllers/admin/admin.controller');
const { verifyToken, requireRole } = require("../middleware/auth");

// Secure all admin routes
router.use(verifyToken, requireRole("ADMIN"));

// Department routes
router.post('/departments', adminController.addDepartment);

// User routes
router.get('/users', adminController.getUsers);

router.post("/toggle-ban", adminController.toggleBanUser);

module.exports = router;
