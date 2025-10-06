const express = require("express");
const {paymobCallback} = require("../controllers/payment.controller");
const router = express.Router();

router.post("/callback", paymobCallback);

module.exports = router;
