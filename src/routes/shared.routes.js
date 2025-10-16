const express = require('express');
const router = express.Router();
const { verifyToken } = require("../middleware/auth");
const sharedController = require('../controllers/shared.controller');

router.get('/departments', verifyToken, sharedController.getDepartments);

router.get("/departments/:id", verifyToken, sharedController.getDepartmentById);

router.get("/transactions", verifyToken, sharedController.getPayments);

router.get("/appointments", verifyToken, sharedController.getAppointments);

router.get("/reviews", verifyToken, sharedController.getMyReviews);

router.get("/myReviews", verifyToken, sharedController.getMyWrittenReviews);
module.exports = router;