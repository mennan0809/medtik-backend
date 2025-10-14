// routes/doctorRoutes.js
const express = require("express");
const router = express.Router();
const {
    requestDoctorUpdate,
    getDoctorProfile,
    addSlot,
    getMyPatients,
    deleteSlot,
    markAppointmentNoShow,
    markAppointmentCompleted,
    rescheduleAppointment,
    cancelAppointment, getMyAppointments
} = require("../controllers/doctor/doctor.controller");

const { verifyToken, requireRole } = require("../middleware/auth");

// ✅ Apply auth & role middleware to all doctor routes
router.use(verifyToken, requireRole("DOCTOR"));

// Profile & Update
router.put("/update", requestDoctorUpdate);
router.get("/profile", getDoctorProfile);

// Slots
router.post("/addSlot", addSlot);
router.delete("/slots/:id", deleteSlot);

// Appointments
router.get("/getMyPatients", getMyPatients);
router.get("/getMyAppointments", getMyAppointments);
router.put("/appointments/:appointmentId/no-show", markAppointmentNoShow);
router.put("/appointments/:appointmentId/completed", markAppointmentCompleted);
router.put("/appointments/:appointmentId/reschedule", rescheduleAppointment);
router.put("/appointments/:appointmentId/cancel", cancelAppointment);

// Export the router
module.exports = router;
