-- AlterTable
ALTER TABLE "channels" ALTER COLUMN "ownerId" DROP NOT NULL;
ALTER TABLE "channels" ALTER COLUMN "telegramOwnerId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "platform_forced_channels" ADD COLUMN "addedByAdminUsername" TEXT NOT NULL DEFAULT '';
ALTER TABLE "platform_forced_channels" ADD COLUMN "joinUrl" TEXT;
ALTER TABLE "platform_forced_channels" ALTER COLUMN "isActive" SET DEFAULT false;

-- CreateEnum
CREATE TYPE "BroadcastCampaignStatus" AS ENUM ('RUNNING', 'STOPPED', 'COMPLETED');

-- CreateEnum
CREATE TYPE "BroadcastTargetMode" AS ENUM ('ALL', 'SELECTED');

-- CreateEnum
CREATE TYPE "BroadcastDeliveryStatus" AS ENUM ('PENDING', 'SENT', 'EXCLUDED', 'UNCERTAIN', 'FAILED', 'STOPPED');

-- CreateTable
CREATE TABLE "broadcast_campaigns" (
    "id" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "status" "BroadcastCampaignStatus" NOT NULL DEFAULT 'RUNNING',
    "targetMode" "BroadcastTargetMode" NOT NULL,
    "includeActive" BOOLEAN NOT NULL DEFAULT true,
    "includeInactive" BOOLEAN NOT NULL DEFAULT false,
    "includeDeleted" BOOLEAN NOT NULL DEFAULT false,
    "createdByAdmin" TEXT NOT NULL,
    "stopRequested" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "broadcast_campaigns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "broadcast_campaign_bots" (
    "campaignId" TEXT NOT NULL,
    "botId" TEXT NOT NULL,

    CONSTRAINT "broadcast_campaign_bots_pkey" PRIMARY KEY ("campaignId","botId")
);

-- CreateTable
CREATE TABLE "broadcast_deliveries" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "botId" TEXT,
    "status" "BroadcastDeliveryStatus" NOT NULL,
    "reason" TEXT,
    "telegramMessageId" BIGINT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "broadcast_deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "broadcast_campaigns_status_createdAt_idx" ON "broadcast_campaigns"("status", "createdAt");

-- CreateIndex
CREATE INDEX "broadcast_deliveries_campaignId_status_idx" ON "broadcast_deliveries"("campaignId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "broadcast_deliveries_campaignId_channelId_key" ON "broadcast_deliveries"("campaignId", "channelId");

-- AddForeignKey
ALTER TABLE "broadcast_campaign_bots" ADD CONSTRAINT "broadcast_campaign_bots_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "broadcast_campaigns"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "broadcast_campaign_bots" ADD CONSTRAINT "broadcast_campaign_bots_botId_fkey" FOREIGN KEY ("botId") REFERENCES "bots"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "broadcast_deliveries" ADD CONSTRAINT "broadcast_deliveries_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "broadcast_campaigns"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "broadcast_deliveries" ADD CONSTRAINT "broadcast_deliveries_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "channels"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "broadcast_deliveries" ADD CONSTRAINT "broadcast_deliveries_botId_fkey" FOREIGN KEY ("botId") REFERENCES "bots"("id") ON DELETE SET NULL ON UPDATE CASCADE;
