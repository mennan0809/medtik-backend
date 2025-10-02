const crypto = require("crypto");
const twilio = require("twilio");
const nodemailer = require("nodemailer");

const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);

function generateOTP() {
    return crypto.randomInt(100000, 999999).toString();
}

async function sendWhatsAppOtp(phone, otp, statusCallback) {
    try {
        const message = await client.messages.create({
            from: process.env.TWILIO_WHATSAPP_FROM,
            to: `whatsapp:${phone}`,
            body: `Your Medtik OTP is: ${otp} (valid 5 minutes)`,
            statusCallback
        });
        console.log("WhatsApp message queued:", message.sid);
        return true;
    } catch (err) {
        console.error("WhatsApp send error:", err.message);
        return false;
    }
}

async function sendEmailOtp(email, otp) {
    try {
        const transporter = nodemailer.createTransport({
            service: "gmail",
            auth: {
                user: process.env.EMAIL_USER,
                pass: process.env.EMAIL_PASS
            }
        });

        // HTML Email template
        const htmlContent = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: auto; border: 1px solid #eee; padding: 20px; border-radius: 8px; background-color: #f9f9f9;">
            <div style="text-align: center;">
                <img src="https://drive.google.com/uc?id=1qgi40MkD0jvxcudc_bnMt2Rp0WANpX30" alt="Medtik Logo" width="150" />
            </div>
            <h2 style="color: #333;">OTP Verification</h2>
            <p>Hello,</p>
            <p>Use the following OTP to verify your Medtik account. This OTP is valid for <strong>5 minutes</strong>.</p>
            <p style="font-size: 24px; font-weight: bold; text-align: center; margin: 20px 0;">${otp}</p>
            <p>If you did not request this, please ignore this email.</p>
            <hr />
            <p style="font-size: 12px; color: #888;">© ${new Date().getFullYear()} Medtik. All rights reserved.</p>
        </div>
        `;

        await transporter.sendMail({
            from: `"Medtik Support" <${process.env.EMAIL_USER}>`,
            to: email,
            subject: "Medtik OTP Verification",
            html: htmlContent
        });

        console.log(`Professional OTP email sent to ${email}`);
        return true;
    } catch (err) {
        console.error("Email OTP failed:", err.message);
        return false;
    }
}

module.exports = { sendEmailOtp };
// Send OTP with callback URL for status updates
async function sendOtp({ phone, email }, statusCallback) {
    const otp = generateOTP();

    const sent = await sendWhatsAppOtp(phone, otp, statusCallback);
    if (!sent) {
        await sendEmailOtp(email, otp);
    }

    return otp;
}

module.exports = { generateOTP, sendOtp, sendWhatsAppOtp, sendEmailOtp };
