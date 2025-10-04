/*
  Warnings:

  - You are about to drop the column `currency` on the `Doctor` table. All the data in the column will be lost.
  - The `cancellationPolicy` column on the `Doctor` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - The `refundPolicy` column on the `Doctor` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - The `reschedulePolicy` column on the `Doctor` table would be dropped and recreated. This will lead to data loss if there is data in the column.

*/
-- CreateEnum
CREATE TYPE "SlotStatus" AS ENUM ('AVAILABLE', 'RESERVED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "UpdateType" ADD VALUE 'LANGUAGE';
ALTER TYPE "UpdateType" ADD VALUE 'AVATAR';

-- AlterTable
ALTER TABLE "Doctor" DROP COLUMN "currency",
DROP COLUMN "cancellationPolicy",
ADD COLUMN     "cancellationPolicy" INTEGER DEFAULT 2,
DROP COLUMN "refundPolicy",
ADD COLUMN     "refundPolicy" BOOLEAN DEFAULT true,
DROP COLUMN "reschedulePolicy",
ADD COLUMN     "reschedulePolicy" INTEGER DEFAULT 1;

-- CreateTable
CREATE TABLE "DoctorSlot" (
    "id" SERIAL NOT NULL,
    "doctorId" INTEGER NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "startTime" TIMESTAMP(3) NOT NULL,
    "duration" INTEGER NOT NULL,
    "chat" BOOLEAN NOT NULL DEFAULT false,
    "voice" BOOLEAN NOT NULL DEFAULT false,
    "video" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "status" "SlotStatus" NOT NULL DEFAULT 'AVAILABLE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DoctorSlot_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "DoctorSlot" ADD CONSTRAINT "DoctorSlot_doctorId_fkey" FOREIGN KEY ("doctorId") REFERENCES "Doctor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
