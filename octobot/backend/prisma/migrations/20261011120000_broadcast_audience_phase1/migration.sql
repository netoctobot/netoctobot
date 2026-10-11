-- CreateEnum
CREATE TYPE "BroadcastAudienceType" AS ENUM ('CHANNELS', 'BOT_USERS', 'BOT_OWNERS');

-- AlterTable
ALTER TABLE "broadcast_campaigns" ADD COLUMN "audienceType" "BroadcastAudienceType" NOT NULL DEFAULT 'CHANNELS';
ALTER TABLE "broadcast_campaigns" ADD COLUMN "includeBotOwners" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "user_bot_preferences" ADD COLUMN "privateChatEstablishedAt" TIMESTAMP(3);
ALTER TABLE "user_bot_preferences" ADD COLUMN "lastPrivateInteractionAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "broadcast_deliveries" ALTER COLUMN "channelId" DROP NOT NULL;
ALTER TABLE "broadcast_deliveries" ADD COLUMN "userId" TEXT;
ALTER TABLE "broadcast_deliveries" ADD COLUMN "recipientTelegramChatId" BIGINT;

-- CreateIndex
CREATE INDEX "user_bot_preferences_botId_privateChatEstablishedAt_idx" ON "user_bot_preferences"("botId", "privateChatEstablishedAt");

-- DropIndex
DROP INDEX "broadcast_deliveries_campaignId_channelId_key";

-- CreateIndex
CREATE UNIQUE INDEX "broadcast_deliveries_campaignId_channelId_key" ON "broadcast_deliveries"("campaignId", "channelId") WHERE "channelId" IS NOT NULL;
CREATE UNIQUE INDEX "broadcast_deliveries_campaignId_userId_key" ON "broadcast_deliveries"("campaignId", "userId") WHERE "userId" IS NOT NULL;

-- AddForeignKey
ALTER TABLE "broadcast_deliveries" ADD CONSTRAINT "broadcast_deliveries_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Check: exactly one of channelId or userId
ALTER TABLE "broadcast_deliveries" ADD CONSTRAINT "broadcast_deliveries_target_check" CHECK (
  (
    "channelId" IS NOT NULL
    AND "userId" IS NULL
  )
  OR (
    "channelId" IS NULL
    AND "userId" IS NOT NULL
  )
);
