const express = require("express");
const router = express.Router();
const {verifyToken, requireRole} = require("../middleware/auth");
const upload = require("../middleware/upload");

const {getAllDoctors, updatePatient, reserveSlot, cancelReservation, getMyAppointments, getMyDoctors, uploadMedicalRecord, getMedicalRecords, getPatientProfile, rescheduleAppointment,
    reviewDoctor,
    updateDoctorReview,
    getDoctorById
} = require("../controllers/patient/patient.controller");

router.use(verifyToken, requireRole("PATIENT"));

router.get("/getDoctors", getAllDoctors);

router.put("/update", updatePatient);

router.post("/reserveSlot", reserveSlot);

router.post("/cancelSlot", cancelReservation);

router.get("/myAppointments", getMyAppointments);

router.get("/getMyDoctors", getMyDoctors);

router.post("/records",  upload.single("file"), uploadMedicalRecord );

router.get("/records", getMedicalRecords);

router.get("/profile", getPatientProfile);

router.post("/reschedule", rescheduleAppointment);

router.post("/review", reviewDoctor);

router.put("/review", updateDoctorReview);

router.get("/doctor/:id", getDoctorById);
module.exports = router;