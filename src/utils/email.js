const nodemailer = require("nodemailer");

const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
    }
});

/**
 * Generic sendEmail function
 */
async function sendEmail(to, subject, htmlContent) {
    try {
        await transporter.sendMail({
            from: `"Medtik Support" <${process.env.EMAIL_USER}>`,
            to,
            subject,
            html: htmlContent
        });
        console.log(`✅ Email sent to ${to} | Subject: ${subject}`);
        return true;
    } catch (err) {
        console.error("❌ Email sending failed:", err.message);
        return false;
    }
}

/**
 * OTP email
 */
async function sendEmailOtp(email, otp) {
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
    return sendEmail(email, "Medtik OTP Verification", htmlContent);
}

/**
 * Doctor Request Email (admin approval needed)
 */
async function sendDoctorRequestEmail(adminEmail, doctorName, requestType) {
    const htmlContent = `
  <div style="font-family: Arial, sans-serif; padding: 20px; background: #f9f9f9; border-radius: 8px;">
      <h2>New Doctor Request</h2>
      <p>Doctor <strong>${doctorName}</strong> has submitted a new request:</p>
      <p style="font-size: 18px; font-weight: bold; color: #007BFF;">${requestType}</p>
      <p>Please review and approve/reject this request from the admin dashboard.</p>
  </div>
  `;
    return sendEmail(adminEmail, "New Doctor Request Pending Approval", htmlContent);
}

module.exports = {
    sendEmail,
    sendEmailOtp,
    sendDoctorRequestEmail
};
