// routes/doctorRoutes.js
const express = require("express");
const router = express.Router();
const { updateDoctor, getDoctorProfile, addSlot, getDoctorsByCountry } = require("../controllers/doctor/doctor.controller");
const {verifyToken, requireRole} = require("../middleware/auth");

router.use(verifyToken, requireRole("DOCTOR"));

router.put("/update", updateDoctor);

router.get("/profile", getDoctorProfile);

router.post("/addSlot", addSlot);

module.exports = router;
