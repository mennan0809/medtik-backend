-- DropIndex
DROP INDEX "public"."Patient_phone_key";

-- AlterTable
ALTER TABLE "Doctor" ADD COLUMN     "mustChangePassword" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "phone" TEXT;

-- AlterTable
ALTER TABLE "User" ALTER COLUMN "fullName" DROP NOT NULL;
