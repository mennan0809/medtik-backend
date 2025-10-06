require('dotenv').config();
const app = require('./app');
const cron = require("node-cron");
const PORT = process.env.PORT || 4000;
const prisma = require("./config/db");

cron.schedule("0 0 * * *", async () => {
    try {
        const now = new Date();
        const result = await prisma.DoctorSlot.deleteMany({
            where: {
                endTime: { lt: now },
            },
        });
        console.log(`🧹 Cleaned up ${result.count} old doctor slots`);
    } catch (err) {
        console.error("Error cleaning up slots:", err);
    }
});
