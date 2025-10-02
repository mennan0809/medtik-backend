// src/middleware/auth.js
const jwt = require("jsonwebtoken");

const JWT_SECRET = process.env.JWT_SECRET || "dev-secret";

// ===========================
// Verify Token Middleware
// ===========================
exports.verifyToken = (req, res, next) => {
    const authHeader = req.headers["authorization"];
    if (!authHeader) return res.status(401).json({ error: "No token provided" });

    const token = authHeader.split(" ")[1]; // Expecting "Bearer <token>"
    if (!token) return res.status(401).json({ error: "Invalid token format" });

    jwt.verify(token, JWT_SECRET, (err, decoded) => {
        if (err) return res.status(403).json({ error: "Invalid or expired token" });

        req.user = decoded; // { id, role, iat, exp }
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
