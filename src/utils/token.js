const jwt = require("jsonwebtoken");

const JWT_SECRET = process.env.JWT_SECRET || "dev-secret";
const JWT_EXPIRY = process.env.JWT_EXPIRY || "1h"; // default 1 hour

// Create token
function generateToken(payload) {
    return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRY });
}

// Verify token
function verifyToken(token) {
    try {
        return jwt.verify(token, JWT_SECRET);
    } catch (err) {
        return null; // return null if invalid/expired
    }
}

// Decode without verifying (useful for role extraction in frontend)
function decodeToken(token) {
    return jwt.decode(token, { complete: true });
}

module.exports = { generateToken, verifyToken, decodeToken };
