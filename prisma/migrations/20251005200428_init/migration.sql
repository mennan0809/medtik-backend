/*
  Warnings:

  - You are about to drop the column `mustChangePassword` on the `Doctor` table. All the data in the column will be lost.

*/
-- CreateEnum
CREATE TYPE "status" AS ENUM ('ACCEPTED', 'REJECTED', 'PENDING', 'NEW');

-- AlterTable
ALTER TABLE "Doctor" DROP COLUMN "mustChangePassword",
ADD COLUMN     "rejectionReason" TEXT,
ADD COLUMN     "status" "status" NOT NULL DEFAULT 'NEW';
