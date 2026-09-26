ALTER TABLE "bot_channel_links"
ADD COLUMN "linkedByTelegramId" BIGINT,
ADD COLUMN "deactivatedAt" TIMESTAMP(3),
ADD COLUMN "deactivationReason" TEXT;

CREATE INDEX "bots_ownerId_deletedAt_idx"
ON "bots"("ownerId", "deletedAt");

CREATE INDEX "channels_ownerId_deletedAt_idx"
ON "channels"("ownerId", "deletedAt");
