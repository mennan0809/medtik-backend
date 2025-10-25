const express = require("express");
const { verifyToken } = require("../middleware/auth");
const chatController = require("../controllers/chat.controller");
const upload = require("../middleware/upload");

const router = express.Router();

router.post("/send", verifyToken, chatController.sendMessage);
router.post('/send-file', verifyToken, upload.single("file"), chatController.sendFile); // file
router.get("/history/:otherId", verifyToken, chatController.getHistory);
router.get("/conversations", verifyToken, chatController.getConversations);

module.exports = router;

