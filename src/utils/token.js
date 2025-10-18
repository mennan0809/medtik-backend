const jwt = require("jsonwebtoken");
const JWT_SECRET = process.env.JWT_SECRET || "dev-secret";
const JWT_EXPIRY = process.env.JWT_EXPIRY || "1h"; // default 1 hour
const AUTH_STRATEGY = process.env.AUTH_STRATEGY || "dev"; // 'dev' = bearer, 'prod' = cookies

// ============================
// Create token
// ============================
function generateToken(payload) {
    return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRY });
}

// ============================
// Verify token
// ============================
function verifyToken(token) {
    try {
        return jwt.verify(token, JWT_SECRET);
    } catch (err) {
        return null; // return null if invalid/expired
    }
}

// ============================
// Decode without verifying
// ============================
function decodeToken(token) {
    return jwt.decode(token, { complete: true });
}

// ============================
// Extract token dynamically (Bearer in dev, cookie in prod)
// ============================
function extractToken(req) {
    let token = null;

    if (AUTH_STRATEGY === "prod") {
        // 🧁 use cookies
        token = req.cookies?.token || null;
    } else {
        // 🧠 use bearer
        const authHeader = req.headers.authorization;
        if (authHeader?.startsWith("Bearer ")) {
            token = authHeader.split(" ")[1];
        }
    }

    return token;
}

module.exports = {
    generateToken,
    verifyToken,
    decodeToken,
    extractToken,
};
