// prisma/seed.js
require('dotenv').config(); // read .env
const bcrypt = require('bcryptjs');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
    const fullName = 'Admin';
    const email = process.env.ADMIN_EMAIL;
    const plain = process.env.ADMIN_PASSWORD;

    if (!email || !plain) {
        console.error('ERROR: ADMIN_EMAIL and ADMIN_PASSWORD must be set in .env');
        process.exit(1);
    }

    const hashed = await bcrypt.hash(plain, 12);

    const admin = await prisma.user.upsert({
        where: { email },
        update: {
            password: hashed,
            role: 'ADMIN'
        },
        create: {
            fullName,
            email,
            password: hashed,
            role: 'ADMIN'
        }
    });

    console.log('✅ Admin created/upserted:', admin.email);
}

main()
    .catch((e) => {
        console.error('Seed failed:', e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
