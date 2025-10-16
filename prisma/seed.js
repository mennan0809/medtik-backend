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

    // ===== DEPARTMENTS =====
    const cardiology = await prisma.department.upsert({
        where: { name: 'cardiology' },
        update: {},
        create: {
            name: 'cardiology',
            description: 'Heart and vascular system specialists.',
        },
    });
    const pediatrics = await prisma.department.upsert({
        where: { name: 'pediatrics' },
        update: {},
        create: {
            name: 'pediatrics',
            description: 'Child healthcare specialists.',
        },
    });
    console.log('🏥 Departments seeded.');

    // ===== DOCTORS =====
    const doctorPassword = await bcrypt.hash('doctor123', 12);

    const generatePricing = () => {
        const services = ['CHAT', 'VOICE', 'VIDEO'];
        const currencies = ['EGP', 'USD', 'SAR', 'AED'];
        const pricing = [];

        for (const service of services) {
            for (const currency of currencies) {
                const price = parseFloat((Math.random() * 200 + 100).toFixed(2));
                pricing.push({ service, currency, price });
            }
        }
        return pricing;
    };

// ===== DOCTORS =====
    const doc1User = await prisma.user.upsert({
        where: { email: 'mennan0809@gmail.com' },
        update: {}, // do nothing if exists
        create: {
            fullName: 'Dr. Sarah Hamed',
            email: 'mennan0809@gmail.com',
            password: doctorPassword,
            role: 'DOCTOR',
            doctor: {
                create: {
                    title: 'Cardiologist',
                    avatarUrl:"https://avatar.iran.liara.run/public/35",
                    departmentId: cardiology.id,
                    yearsOfExperience: 12,
                    licenseNumber: 'DOC-CARD-001',
                    bio: 'Experienced cardiologist specializing in heart disease.',
                    phone: '+201228136363',
                    languages: ['English', 'Arabic'],
                    hospitals: ['GUC Medical Center'],
                    education: ['Cairo University'],
                    certificates: ['Board Certified Cardiologist'],
                    pricing: { create: generatePricing() },
                    availability: { create: { chat: true, voice: true, video: true } },
                },
            },
        },
        include: { doctor: true },
    });

    const doc2User = await prisma.user.upsert({
        where: { email: 'mnaem@panarab-media.com' },
        update: {},
        create: {
            fullName: 'Dr. Karim Youssef',
            email: 'mnaem@panarab-media.com',
            password: doctorPassword,
            role: 'DOCTOR',
            doctor: {
                create: {
                    title: 'Pediatrician',
                    departmentId: pediatrics.id,
                    yearsOfExperience: 8,
                    avatarUrl: 'https://www.w3schools.com/w3images/avatar6.png',
                    licenseNumber: 'DOC-PED-002',
                    bio: 'Pediatrician with focus on child nutrition and development.',
                    phone: '+201228136363',
                    languages: ['English', 'French'],
                    hospitals: ['Children’s Hospital Egypt'],
                    education: ['Ain Shams University'],
                    certificates: ['Certified Pediatric Specialist'],
                    pricing: { create: generatePricing() },
                    availability: { create: { chat: true, voice: true, video: true } },
                },
            },
        },
        include: { doctor: true },
    });

// ===== PATIENTS =====
    const patientPassword = await bcrypt.hash('patient123', 12);

    const pat1User = await prisma.user.upsert({
        where: { email: 'menna.naem08@gmail.com' },
        update: {},
        create: {
            fullName: 'Mona El Said',
            email: 'menna.naem08@gmail.com',
            password: patientPassword,
            role: 'PATIENT',
            patient: {
                create: {
                    gender: 'Female',
                    country: 'Egypt',
                    phone: '+201228136363',
                    birthdate: new Date('1995-06-15'),
                    verified: true,
                },
            },
        },
        include: { patient: true },
    });

    const pat2User = await prisma.user.upsert({
        where: { email: 'aa.mennaa@outlook.com' },
        update: {},
        create: {
            fullName: 'Ahmed Khaled',
            email: 'aa.mennaa@outlook.com',
            password: patientPassword,
            role: 'PATIENT',
            patient: {
                create: {
                    gender: 'Male',
                    country: 'UAE',
                    phone: '+201228136363',
                    birthdate: new Date('1990-12-05'),
                    verified: true,
                },
            },
        },
        include: { patient: true },
    });

    console.log('🧍 Patients seeded.');

    // ===== DOCTOR SLOTS =====
    await prisma.doctorSlot.createMany({
        data: [
            {
                doctorId: doc1User.doctor.id,
                date: new Date('2025-10-10'),
                startTime: new Date('2025-10-10T09:00:00Z'),
                endTime: new Date('2025-10-10T09:30:00Z'),
                chat: true,
                video: true,
            },
            {
                doctorId: doc2User.doctor.id,
                date: new Date('2025-10-11'),
                startTime: new Date('2025-10-11T10:00:00Z'),
                endTime: new Date('2025-10-11T10:30:00Z'),
                voice: true,
            },
        ],
    });
    console.log('🕒 Doctor slots created.');

    // ===== REVIEWS =====
    await prisma.review.createMany({
        data: [
            // Patients reviewing doctors
            {
                reviewerId: pat1User.id,   // patient reviewing doctor
                revieweeId: doc1User.id,   // doctor being reviewed
                rating: 5,
                comment: 'Dr. Sarah was amazing and helpful!',
            },
            {
                reviewerId: pat2User.id,
                revieweeId: doc2User.id,
                rating: 4,
                comment: 'Good experience overall!',
            },

            // Doctors reviewing patients
            {
                reviewerId: doc1User.id,   // doctor reviewing patient
                revieweeId: pat1User.id,   // patient being reviewed
                rating: 5,
                comment: 'Patient was very punctual and cooperative.',
            },
            {
                reviewerId: doc2User.id,
                revieweeId: pat2User.id,
                rating: 4,
                comment: 'Good communication and followed instructions.',
            },
        ],
    });

    console.log('⭐ Reviews seeded.');

    // ===== CONVERSATION & MESSAGES =====
    await prisma.conversation.create({
        data: {
            participants: { connect: [{ id: doc1User.id }, { id: pat1User.id }] },
            messages: {
                create: [
                    {
                        senderId: pat1User.id,
                        content: 'Hello Doctor!',
                        type: 'TEXT',
                    },
                    {
                        senderId: doc1User.id,
                        content: 'Hi Mona, how can I help you today?',
                        type: 'TEXT',
                    },
                ],
            },
        },
    });
    console.log('💬 Chat seeded.');

    // ===== NOTIFICATIONS =====
    await prisma.notification.createMany({
        data: [
            {
                userId: doc1User.id,
                type: 'APPOINTMENT',
                title: 'New patient booked a slot!',
                message: 'Mona El Said booked a chat slot with you.',
            },
            {
                userId: pat1User.id,
                type: 'SYSTEM',
                title: 'Welcome!',
                message: 'Your account is verified successfully 🎉',
            },
        ],
    });
    console.log('🔔 Notifications seeded.');

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
