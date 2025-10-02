const express = require("express");
const router = express.Router();
const otpController = require("../controllers/otp.controller");

router.post("/status", express.urlencoded({ extended: false }), otpController.statusCallback);

module.exports = router;
