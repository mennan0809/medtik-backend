/*
  Warnings:

  - You are about to drop the column `notes` on the `MedicalRecord` table. All the data in the column will be lost.
  - You are about to drop the column `type` on the `MedicalRecord` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "MedicalRecord" DROP COLUMN "notes",
DROP COLUMN "type";
