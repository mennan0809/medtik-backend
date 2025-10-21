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

    // 🪵 Debug logging
    console.log("\n🧩 [extractToken] Incoming request debug:");
    console.log("  🌍 Origin:", req.headers.origin || "unknown");
    console.log("  🍪 Cookie Token:", cookieToken ? "✅ Present" : "❌ None");
    console.log("  🔐 Header Token:", headerToken ? "✅ Present" : "❌ None");

    if (cookieToken) console.log("  🔎 Cookie (truncated):", cookieToken.slice(0, 25) + "...");
    if (headerToken) console.log("  🔎 Header (truncated):", headerToken.slice(0, 25) + "...");

    const token = cookieToken || headerToken;

    console.log("  🎯 Using token from:", cookieToken ? "COOKIE" : headerToken ? "HEADER" : "NONE");

    return token || null;
}

// ===========================
// Verify Token Middleware
// ===========================
exports.verifyToken = async (req, res, next) => {
    console.log("\n🛡️ [verifyToken] Running verification...");

    const token = extractToken(req);
    if (!token) {
        console.warn("❌ No token provided in cookies or headers");
        return res.status(401).json({ error: "No token provided" });
    }

    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        console.log("✅ Token verified successfully");
        console.log("  📦 Decoded payload:", decoded);

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
        console.log("👤 req.user set:", req.user);

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
        console.log("\n🎭 [requireRole] Checking roles...");
        console.log("  🧠 req.user:", req.user);
        console.log("  🎯 Required roles:", roles);

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

        console.log("✅ Role authorized:", req.user.role);
        next();
    };
};
