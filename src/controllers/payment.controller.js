const crypto = require("crypto");
const { PrismaClient } = require("@prisma/client");
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

        // ✅ 1. Verify HMAC
        if (!verifyHmac(obj, hmac)) {
            console.warn("⚠️ Invalid HMAC signature");
            return res.status(400).send("Invalid signature");
        }

        const merchantOrderId = obj.order.merchant_order_id;
        const success = obj.success === true || obj.success === "true";
        const paymobTransactionId = obj.id;

        // e.g. merchant_order_id = PAY-12-1699999999999
        const paymentId = parseInt(merchantOrderId.split("-")[1]);

        // ✅ 2. Update payment
        const payment = await prisma.payment.update({
            where: { id: paymentId },
            data: {
                status: success ? "PAID" : "FAILED",
                paymobTransactionId: paymobTransactionId.toString(),
            },
            include: { appointment: true },
        });

        // ✅ 3. Handle failure cleanup
        if (!success && payment.appointmentId) {
            console.log("❌ Payment failed → Cleaning up appointment and slot");

            await prisma.$transaction(async (tx) => {
                // Delete the appointment
                await tx.appointment.delete({
                    where: { id: payment.appointmentId },
                });

                // Find and free the related doctor slot
                const slot = await tx.doctorSlot.findFirst({
                    where: {
                        doctorId: payment.doctorId,
                        date: payment.appointment.date,
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
