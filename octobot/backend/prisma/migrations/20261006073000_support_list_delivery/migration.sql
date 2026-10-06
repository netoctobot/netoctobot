-- AlterEnum
ALTER TYPE "SupportListPublicationStatus" ADD VALUE 'SENDING';
ALTER TYPE "SupportListPublicationStatus" ADD VALUE 'UNCONFIRMED';

-- AlterTable
ALTER TABLE "support_list_publications" ADD COLUMN "sendAttemptedAt" TIMESTAMP(3),
ADD COLUMN "ownerNotified" BOOLEAN NOT NULL DEFAULT false;
