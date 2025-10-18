const prisma = require("../config/db");
const { sendEmailOtp } = require("../utils/otp");

// Twilio Status Callback handler
exports.statusCallback = async (req, res) => {
    const { MessageSid, MessageStatus, ErrorCode, To } = req.body;

    if (MessageStatus === "failed") {
        // Fallback to email
        const phone = To.replace("whatsapp:", "");
        const patient = await prisma.patient.findFirst({
            where: { phone },
            include: { user: true }
        });

        if (patient) {
            await sendEmailOtp(patient.user.email, patient.otp);
        } else {
            console.warn(`No patient found with phone ${phone}`);
        }
    }

    res.sendStatus(200);
};
