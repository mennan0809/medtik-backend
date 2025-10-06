/*
  Warnings:

  - You are about to drop the column `refundPolicy` on the `Doctor` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "Doctor" DROP COLUMN "refundPolicy",
ADD COLUMN     "noShowPolicy" BOOLEAN DEFAULT true;
