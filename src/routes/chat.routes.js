const express = require("express");
const { verifyToken } = require("../middleware/auth");
const chatController = require("../controllers/chat.controller");

module.exports = (io, onlineUsers) => {
    const router = express.Router();

    // Wrap controller functions to inject io and onlineUsers
    const sendMessage = (req, res) => chatController.sendMessage(io, onlineUsers)(req, res);

    // Routes
    router.post("/send", verifyToken, sendMessage);
    router.get("/history/:otherId", verifyToken, chatController.getHistory);
    router.get("/conversations", verifyToken, chatController.getConversations);

    return router;
};
