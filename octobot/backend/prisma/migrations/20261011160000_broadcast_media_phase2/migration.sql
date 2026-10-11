-- CreateEnum
CREATE TYPE "BroadcastContentKind" AS ENUM ('TEXT', 'PHOTO', 'VIDEO', 'AUDIO', 'VOICE', 'DOCUMENT', 'ANIMATION');

-- AlterTable
ALTER TABLE "broadcast_campaigns" ADD COLUMN "contentKind" "BroadcastContentKind" NOT NULL DEFAULT 'TEXT';
ALTER TABLE "broadcast_campaigns" ADD COLUMN "caption" TEXT;
ALTER TABLE "broadcast_campaigns" ADD COLUMN "linkButtons" JSONB;
ALTER TABLE "broadcast_campaigns" ADD COLUMN "mediaAssetId" TEXT;
ALTER TABLE "broadcast_campaigns" ADD COLUMN "endedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "broadcast_media_assets" (
    "id" TEXT NOT NULL,
    "uploadedByAdmin" TEXT NOT NULL,
    "originalName" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "mimeTypeReported" TEXT,
    "detectedMime" TEXT,
    "contentKind" "BroadcastContentKind" NOT NULL,
    "sizeBytes" BIGINT NOT NULL,
    "fileDeletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3),

    CONSTRAINT "broadcast_media_assets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "broadcast_media_bot_files" (
    "id" TEXT NOT NULL,
    "mediaAssetId" TEXT NOT NULL,
    "botId" TEXT NOT NULL,
    "telegramFileId" TEXT NOT NULL,
    "telegramFileUniqueId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "broadcast_media_bot_files_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "broadcast_delivery_messages" (
    "id" TEXT NOT NULL,
    "deliveryId" TEXT NOT NULL,
    "telegramMessageId" BIGINT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "broadcast_delivery_messages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "broadcast_campaigns_mediaAssetId_key" ON "broadcast_campaigns"("mediaAssetId");
CREATE UNIQUE INDEX "broadcast_media_assets_storageKey_key" ON "broadcast_media_assets"("storageKey");
CREATE INDEX "broadcast_media_assets_expiresAt_idx" ON "broadcast_media_assets"("expiresAt");
CREATE INDEX "broadcast_media_assets_fileDeletedAt_idx" ON "broadcast_media_assets"("fileDeletedAt");
CREATE UNIQUE INDEX "broadcast_media_bot_files_mediaAssetId_botId_key" ON "broadcast_media_bot_files"("mediaAssetId", "botId");
CREATE UNIQUE INDEX "broadcast_delivery_messages_deliveryId_sortOrder_key" ON "broadcast_delivery_messages"("deliveryId", "sortOrder");

-- AddForeignKey
ALTER TABLE "broadcast_campaigns" ADD CONSTRAINT "broadcast_campaigns_mediaAssetId_fkey" FOREIGN KEY ("mediaAssetId") REFERENCES "broadcast_media_assets"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "broadcast_media_bot_files" ADD CONSTRAINT "broadcast_media_bot_files_mediaAssetId_fkey" FOREIGN KEY ("mediaAssetId") REFERENCES "broadcast_media_assets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "broadcast_media_bot_files" ADD CONSTRAINT "broadcast_media_bot_files_botId_fkey" FOREIGN KEY ("botId") REFERENCES "bots"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "broadcast_delivery_messages" ADD CONSTRAINT "broadcast_delivery_messages_deliveryId_fkey" FOREIGN KEY ("deliveryId") REFERENCES "broadcast_deliveries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
