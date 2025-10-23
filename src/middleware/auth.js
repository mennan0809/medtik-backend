const jwt = require("jsonwebtoken");
const prisma = require("../config/db");

const JWT_SECRET = process.env.JWT_SECRET || "dev-secret";

// ===========================
// Helper: Extract Token (Bearer or Cookie)
// ===========================
function extractToken(req) {
    const cookieToken = req.cookies?.token;
    const authHeader = req.headers["authorization"];

    const headerToken = (() => {
        if (!authHeader) return null;
        const parts = authHeader.split(" ");
        return parts.length === 2 && parts[0] === "Bearer" ? parts[1] : null;
    })();

    const token = cookieToken || headerToken;

    return token || null;
}

// ===========================
// Verify Token Middleware
// ===========================
exports.verifyToken = async (req, res, next) => {
    const token = extractToken(req);
    if (!token) {
        console.warn("❌ No token provided in cookies or headers");
        return res.status(401).json({ error: "No token provided" });
    }

    try {
        const decoded = jwt.verify(token, JWT_SECRET);

        const user = await prisma.user.findUnique({ where: { id: decoded.id } });

        if (!user) {
            console.warn("⚠️ User not found in database:", decoded.id);
            return res.status(403).json({ error: "User not found" });
        }

        if (user.status === "BANNED") {
            console.warn("🚫 User is banned:", decoded.id);
            return res.status(403).json({ error: "Account is banned or inactive" });
        }

        req.user = decoded;

        next();
    } catch (err) {
        console.error("💥 JWT verification failed:", err.message);
        return res.status(403).json({ error: "Invalid or expired token" });
    }
};

// ===========================
// Role-based Access Control
// ===========================
exports.requireRole = (...roles) => {
    return (req, res, next) => {

        if (!req.user) {
            console.warn("❌ req.user is missing (verifyToken likely failed)");
            return res.status(401).json({ error: "Unauthorized" });
        }

        if (!roles.includes(req.user.role)) {
            console.warn(
                `🚫 Role mismatch: required [${roles.join(", ")}], got "${req.user.role}"`
            );
            return res.status(403).json({ error: "Forbidden: insufficient role" });
        }

        next();
    };
};
