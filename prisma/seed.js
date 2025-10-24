// prisma/seed.js
require('dotenv').config();
const bcrypt = require('bcryptjs');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
    console.log('🌱 Starting seed...');

    // ===== ADMIN =====
    const adminEmail = process.env.ADMIN_EMAIL;
    const adminPass = process.env.ADMIN_PASSWORD;
    if (!adminEmail || !adminPass) {
        console.error('❌ ADMIN_EMAIL and ADMIN_PASSWORD must be set in .env');
        process.exit(1);
    }

    const hashedAdminPass = await bcrypt.hash(adminPass, 12);
    const admin = await prisma.user.upsert({
        where: { email: adminEmail },
        update: { password: hashedAdminPass, role: 'ADMIN' },
        create: {
            fullName: 'Super Admin',
            email: adminEmail,
            password: hashedAdminPass,
            role: 'ADMIN',
        },
    });
    console.log(`✅ Admin: ${admin.email}`);

    console.log('✅ All seed data created successfully!');
}

main()
    .catch((e) => {
        console.error('❌ Seed failed:', e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
