const express = require("express");
const router = express.Router();
const chatController = require("../controllers/chat.controller");

// Send a message (creates conversation if needed)
router.post("/send", chatController.sendMessage);

// Get all chats for a user
router.get("/:userId", chatController.getChats);

module.exports = router;
