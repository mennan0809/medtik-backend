// utils/notification.js
const prisma = require("../config/db");
const { sendEmail } = require("./email");
const { getIO } = require("./socket");

/**
 * Create and send notification (DB + Socket + Email)
 */
async function pushNotification({ userId, type, title, message, redirectUrl = null, metadata = {}, email = null }) {
    let notification = null;

    try {
        // 1️⃣ Save notification in DB
        notification = await prisma.notification.create({
            data: {
                userId,
                type,
                title,
                message,
                redirectUrl,
                metadata: metadata || {}
            },
        });
    } catch (err) {
        console.error("❌ Failed to save notification in DB:", err.message);
        return null; // cannot continue without DB record
    }

    try {
        // 2️⃣ Emit real-time notification via socket
        const io = getIO();
        if (io) {
            console.log("EMMITTED" + userId);

            io.to(String(userId)).emit("notification:new", notification);
        }
    } catch (err) {
        console.error("❌ Failed to emit socket notification:", err.message);
    }

    try {
        // 3️⃣ Send email if user email is provided
        if (email) {
            const htmlContent = `
                <div style="font-family: Arial, sans-serif; padding: 20px; background: #f9f9f9; border-radius: 8px;">
                    <h2>${title}</h2>
                    <p>${message}</p>
                    ${redirectUrl ? `<a href="${redirectUrl}" style="display:inline-block; margin-top:10px; padding:10px 15px; background:#007bff; color:#fff; border-radius:5px; text-decoration:none;">View Details</a>` : ""}
                </div>
            `;
            await sendEmail(email, title, htmlContent);
        }
    } catch (err) {
        console.error("❌ Failed to send email notification:", err.message);
    }

    return notification;
}

async function pushAdminNotification({ title, message, redirectUrl = null }) {
    let notification = null;

    try {
        // 1️⃣ Save admin notification in DB
        notification = await prisma.adminNotification.create({
            data: {
                title,
                message,
                redirectUrl,
            },
        });
    } catch (err) {
        console.error("❌ Failed to save admin notification in DB:", err.message);
        return null;
    }

    try {
        // 2️⃣ Emit to all connected admins
        const io = getIO();
        if (io) {
            io.to("admins").emit("admin:notification:new", notification);
        }
    } catch (err) {
        console.error("❌ Failed to emit admin socket notification:", err.message);
    }

    return notification;
}

module.exports = { pushNotification, pushAdminNotification };
