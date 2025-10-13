require('dotenv').config();
const app = require('./app');
const cron = require("node-cron");
const prisma = require("./config/db");

const PORT = process.env.PORT || 4000;

// ===== Server start =====
console.log(`🚀 Server starting at ${new Date().toLocaleString()} on port ${PORT}`);

// ===== Cron: delete old doctor slots =====
cron.schedule("0 0 * * *", async () => {
    try {
        const now = new Date();
        const result = await prisma.doctorSlot.deleteMany({
            where: {
                endTime: { lt: now },
            },
        });
    } catch (err) {
        console.error("❌ Error cleaning up slots:", err);
    }
});

// ===== Cron: cleanup unpaid payments older than 15 minutes =====
cron.schedule("*/16 * * * *", async () => { // every minute for testing
    const now = new Date();

    try {
        const fifteenMinutesAgo = new Date(Date.now() - 15 * 60 * 1000);

        const unpaidPayments = await prisma.payment.findMany({
            where: {
                status: "UNPAID",
                createdAt: { lt: fifteenMinutesAgo },
            },
            include: { appointment: true },
        });

        for (const payment of unpaidPayments) {

            if (!payment.appointment) {
                continue;
            }

            await prisma.$transaction(async (tx) => {
                await tx.appointment.delete({
                    where: { id: payment.appointment.id },
                });

                const slot = await tx.DoctorSlot.findFirst({
                    where: {
                        doctorId: payment.doctorId,
                        startTime: payment.appointment.date,
                    },
                });

                if (slot) {
                    await tx.DoctorSlot.update({
                        where: { id: slot.id },
                        data: { status: "AVAILABLE" },
                    });
                }

                await tx.payment.delete({
                    where: { id: payment.id },
                });
            });
        }

    } catch (err) {
        console.error("❌ Error cleaning up unpaid payments:", err);
    }
});
