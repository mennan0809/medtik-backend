// src/middleware/auth.js
const jwt = require("jsonwebtoken");
const prisma = require("../config/db");

const JWT_SECRET = process.env.JWT_SECRET || "dev-secret";

// ===========================
// Verify Token Middleware
// ===========================
exports.verifyToken = async (req, res, next) => {
    const authHeader = req.headers["authorization"];
    if (!authHeader) return res.status(401).json({ error: "No token provided" });

    const token = authHeader.split(" ")[1];
    if (!token) return res.status(401).json({ error: "Invalid token format" });

    jwt.verify(token, JWT_SECRET, async (err, decoded) => {
        if (err) return res.status(403).json({ error: "Invalid or expired token" });

        // Check if user is banned in DB
        const user = await prisma.user.findUnique({ where: { id: decoded.id } });
        if (!user || user.status === "BANNED") {
            return res.status(403).json({ error: "Account is banned or no longer exists" });
        }

        req.user = decoded;
        next();
    });
};

// ===========================
// Role-based Access Control
// ===========================
exports.requireRole = (...roles) => {
    return (req, res, next) => {
        if (!req.user) return res.status(401).json({ error: "Unauthorized" });

        if (!roles.includes(req.user.role)) {
            return res.status(403).json({ error: "Forbidden: insufficient role" });
        }

        next();
    };
};
