const jwt = require("jsonwebtoken");
const prisma = require("../config/db");

const JWT_SECRET = process.env.JWT_SECRET || "dev-secret";
const AUTH_STRATEGY = process.env.AUTH_STRATEGY || "dev"; // "dev" or "prod"

// ===========================
// Helper: Extract Token (Bearer or Cookie)
// ===========================
function extractToken(req) {
    if (AUTH_STRATEGY === "prod") {
        // token stored in cookie
        return req.cookies?.token || null;
    }

    // dev: token sent in Authorization header
    const authHeader = req.headers["authorization"];
    if (!authHeader) return null;

    const parts = authHeader.split(" ");
    if (parts.length !== 2 || parts[0] !== "Bearer") return null;

    return parts[1];
}

// ===========================
// Verify Token Middleware
// ===========================
exports.verifyToken = async (req, res, next) => {
    const token = extractToken(req);
    if (!token) return res.status(401).json({ error: "No token provided" });

    try {
        const decoded = jwt.verify(token, JWT_SECRET);

        // Check if user exists + not banned
        const user = await prisma.user.findUnique({ where: { id: decoded.id } });
        if (!user || user.status === "BANNED") {
            return res.status(403).json({ error: "Account is banned or inactive" });
        }

        req.user = decoded;
        next();
    } catch (err) {
        return res.status(403).json({ error: "Invalid or expired token" });
    }
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
