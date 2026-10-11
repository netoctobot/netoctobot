-- CreateEnum
CREATE TYPE "BroadcastCreatedByKind" AS ENUM ('ADMIN', 'BOT_OWNER');

-- AlterEnum
ALTER TYPE "BroadcastAudienceType" ADD VALUE 'CHANNELS_AND_USERS';

-- AlterTable
ALTER TABLE "broadcast_campaigns" ADD COLUMN "initiatorBotId" TEXT;
ALTER TABLE "broadcast_campaigns" ADD COLUMN "createdByUserId" TEXT;
ALTER TABLE "broadcast_campaigns" ADD COLUMN "createdByKind" "BroadcastCreatedByKind" NOT NULL DEFAULT 'ADMIN';
ALTER TABLE "broadcast_campaigns" ADD COLUMN "publishNonce" TEXT;

-- AlterTable
ALTER TABLE "broadcast_media_assets" ALTER COLUMN "uploadedByAdmin" DROP NOT NULL;
ALTER TABLE "broadcast_media_assets" ADD COLUMN "uploaderBotId" TEXT;
ALTER TABLE "broadcast_media_assets" ADD COLUMN "uploaderUserId" TEXT;
ALTER TABLE "broadcast_media_assets" ADD COLUMN "draftOwnerTelegramId" BIGINT;

CREATE UNIQUE INDEX "broadcast_campaigns_publishNonce_key" ON "broadcast_campaigns"("publishNonce");
CREATE INDEX "broadcast_campaigns_initiatorBotId_createdAt_idx" ON "broadcast_campaigns"("initiatorBotId", "createdAt");
