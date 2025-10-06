// routes/doctorRoutes.js
const express = require("express");
const router = express.Router();
const { requestDoctorUpdate, getDoctorProfile, addSlot, getMyPatients } = require("../controllers/doctor/doctor.controller");
const {verifyToken, requireRole} = require("../middleware/auth");

router.use(verifyToken, requireRole("DOCTOR"));

router.put("/update", requestDoctorUpdate);

router.get("/profile", getDoctorProfile);

router.post("/addSlot", addSlot);

router.get("/getMyPatients", getMyPatients);

module.exports = router;
