const express = require("express");
const router = express.Router();
const {verifyToken, requireRole} = require("../middleware/auth");

const {getDoctors, updatePatient, reserveSlot, cancelReservation, getMyAppointments} = require("../controllers/patient/patient.controller");

router.use(verifyToken, requireRole("PATIENT"));

router.get("/getDoctors", getDoctors);

router.put("/update", updatePatient);

router.post("/reserveSlot", reserveSlot);

router.post("/cancelSlot", cancelReservation);

router.get("/myAppointments", getMyAppointments);

module.exports = router;