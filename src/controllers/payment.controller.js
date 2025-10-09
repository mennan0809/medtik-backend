const crypto = require("crypto");
const { PrismaClient } = require("@prisma/client");
const {pushNotification} = require("../utils/notifications");
const prisma = new PrismaClient();

const PAYMOB_HMAC_SECRET = process.env.PAYMOB_HMAC;

function verifyHmac(obj, hmac) {
    const hmacString = [
        obj.amount_cents,
        obj.created_at,
        obj.currency,
        obj.error_occured,
        obj.has_parent_transaction,
        obj.id,
        obj.integration_id,
        obj.is_3d_secure,
        obj.is_auth,
        obj.is_capture,
        obj.is_refunded,
        obj.is_standalone_payment,
        obj.is_voided,
        obj.order.id,
        obj.owner,
        obj.pending,
        obj.source_data?.pan || "",
        obj.source_data?.sub_type || "",
        obj.source_data?.type || "",
        obj.success,
    ].join("");

    const generatedHmac = crypto
        .createHmac("sha512", PAYMOB_HMAC_SECRET)
        .update(hmacString)
        .digest("hex");

    console.log(generatedHmac + "COMPARED TO" + hmac);

    return generatedHmac === hmac;
}

exports.paymobCallback = async (req, res) => {
    try {
        const hmac = req.query.hmac;
        const { obj } = req.body;

        // 1️⃣ Verify HMAC
        if (!verifyHmac(obj, hmac)) {
            console.warn("⚠️ Invalid HMAC signature");
            return res.status(400).send("Invalid signature");
        }

        const merchantOrderId = obj.order.merchant_order_id;
        const success = obj.success === true || obj.success === "true";
        const paymobTransactionId = obj.id;
        const paymentId = parseInt(merchantOrderId.split("-")[1]);

        // 2️⃣ Update payment status
        const payment = await prisma.payment.update({
            where: { id: paymentId },
            data: {
                status: success ? "PAID" : "FAILED",
                paymobTransactionId: paymobTransactionId.toString(),
            },
            include: { appointment: true },
        });

        if (obj.is_refunded && payment.appointmentId) {
            await prisma.payment.update({
                where: { id: paymentId },
                data: { status: "REFUNDED" },
            });

            // Optional: notify patient
            const patient = await prisma.patient.findUnique({
                where: { id: payment.patientId },
                include: { user: true },
            });

            await pushNotification({
                userId: patient.user.id,
                type: "PAYMENT",
                title: "Payment Refunded",
                message: `Your payment for appointment #${payment.appointmentId} has been refunded.`,
                redirectUrl: `/patient/payments/${paymentId}`,
                metadata: { paymentId },
                email: patient.user.email,
            });
        }

        // 3️⃣ Handle failed payments
        if (!success && payment.appointmentId) {
            console.log("❌ Payment failed → Cleaning up appointment and slot");
            await prisma.$transaction(async (tx) => {
                await tx.appointment.delete({ where: { id: payment.appointmentId } });

                const slot = await tx.doctorSlot.findFirst({
                    where: {
                        doctorId: payment.doctorId,
                        startTime: payment.appointment.date,
                    },
                });
                if (slot) {
                    await tx.doctorSlot.update({
                        where: { id: slot.id },
                        data: { status: "AVAILABLE" },
                    });
                }
            });
        }

        // 4️⃣ Notifications for successful payments
        if (success && payment.appointmentId) {
            const appointment = payment.appointment;

            await prisma.appointment.update({
                where: { id: payment.appointmentId },
                data: {
                    status: "CONFIRMED"
                },
            });

            const doctor = await prisma.doctor.findUnique({
                where: { id: appointment.doctorId },
                include: { user: true },
            });

            const patient = await prisma.patient.findUnique({
                where: { id: appointment.patientId },
                include: { user: true },
            });

            // Notify doctor
            await pushNotification({
                userId: doctor.user.id,
                type: "APPOINTMENT",
                title: "New Appointment Request",
                message: `You have a new appointment reservation from ${patient.user.fullName} on ${new Date(appointment.date).toLocaleString()}.`,
                redirectUrl: `/doctor/appointments/${appointment.id}`,
                metadata: { appointmentId: appointment.id },
                email: doctor.user.email,
            });

            // Notify patient
            await pushNotification({
                userId: patient.user.id,
                type: "APPOINTMENT",
                title: "Appointment Confirmed",
                message: `Your appointment to Dr. ${doctor.user.fullName} has been confirmed on ${new Date(appointment.date).toLocaleString()}.`,
                redirectUrl: `/patient/appointments/${appointment.id}`,
                metadata: { appointmentId: appointment.id, doctorId: doctor.id },
                email: patient.user.email,
            });
        }

        console.log(
            success
                ? `✅ Payment successful [paymentId=${paymentId}, transactionId=${paymobTransactionId}]`
                : `❌ Payment failed [paymentId=${paymentId}, appointmentId=${payment.appointmentId}]`
        );

        res.status(200).send("OK");
    } catch (err) {
        console.error("Callback error:", err);
        res.status(500).send("Server error");
    }
};
