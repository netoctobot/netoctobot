-- CreateEnum
CREATE TYPE "SupportListAcceptanceMode" AS ENUM ('MANUAL', 'AUTO');

-- CreateEnum
CREATE TYPE "SupportListFormat" AS ENUM ('TEXT', 'BUTTONS');

-- CreateEnum
CREATE TYPE "SupportListScheduleMode" AS ENUM ('DEFAULT', 'CUSTOM');

-- CreateEnum
CREATE TYPE "SupportListAcceptanceStatus" AS ENUM ('PENDING', 'ACCEPTED', 'REJECTED');

-- CreateEnum
CREATE TYPE "SupportListCycleStatus" AS ENUM ('PENDING', 'PUBLISHING', 'PUBLISHED', 'SKIPPED', 'FAILED');

-- CreateEnum
CREATE TYPE "SupportListPublicationStatus" AS ENUM ('PENDING', 'SENT', 'SKIPPED', 'FAILED', 'DELETED', 'DELETE_FAILED');

-- CreateTable
CREATE TABLE "support_list_settings" (
    "id" TEXT NOT NULL,
    "botId" TEXT NOT NULL,
    "listName" TEXT NOT NULL DEFAULT 'Support list',
    "acceptanceMode" "SupportListAcceptanceMode" NOT NULL DEFAULT 'MANUAL',
    "format" "SupportListFormat" NOT NULL DEFAULT 'TEXT',
    "timeZone" TEXT NOT NULL DEFAULT 'UTC',
    "publishingEnabled" BOOLEAN NOT NULL DEFAULT true,
    "scheduleMode" "SupportListScheduleMode" NOT NULL DEFAULT 'DEFAULT',
    "retentionMinutes" INTEGER NOT NULL DEFAULT 180,
    "customTimes" JSONB NOT NULL DEFAULT '[]',
    "rotationOffset" INTEGER NOT NULL DEFAULT 0,
    "contactUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "support_list_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "support_list_memberships" (
    "id" TEXT NOT NULL,
    "settingsId" TEXT NOT NULL,
    "botId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "channelTelegramId" BIGINT NOT NULL,
    "addedByUserId" TEXT NOT NULL,
    "acceptanceStatus" "SupportListAcceptanceStatus" NOT NULL,
    "participantDisabled" BOOLEAN NOT NULL DEFAULT false,
    "adminDisabled" BOOLEAN NOT NULL DEFAULT false,
    "adminDisableReason" TEXT,
    "permissionsLost" BOOLEAN NOT NULL DEFAULT false,
    "inviteUnavailable" BOOLEAN NOT NULL DEFAULT false,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "support_list_memberships_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "support_list_cycles" (
    "id" TEXT NOT NULL,
    "settingsId" TEXT NOT NULL,
    "botId" TEXT NOT NULL,
    "scheduledAt" TIMESTAMP(3) NOT NULL,
    "deleteAt" TIMESTAMP(3) NOT NULL,
    "rotationOffset" INTEGER NOT NULL,
    "snapshot" JSONB,
    "status" "SupportListCycleStatus" NOT NULL DEFAULT 'PENDING',
    "sealedAt" TIMESTAMP(3),
    "ownerNotified" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "support_list_cycles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "support_list_publications" (
    "id" TEXT NOT NULL,
    "cycleId" TEXT NOT NULL,
    "membershipId" TEXT NOT NULL,
    "channelTelegramId" BIGINT NOT NULL,
    "messageId" BIGINT,
    "status" "SupportListPublicationStatus" NOT NULL DEFAULT 'PENDING',
    "deleteAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "support_list_publications_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "support_list_settings_botId_key" ON "support_list_settings"("botId");

-- One live membership per channel inside a bot. Rejected and soft-deleted rows stay for history.
CREATE UNIQUE INDEX "support_list_memberships_live_channel_key"
ON "support_list_memberships"("botId", "channelTelegramId")
WHERE "deletedAt" IS NULL AND "acceptanceStatus" <> 'REJECTED';

-- CreateIndex
CREATE INDEX "support_list_memberships_botId_acceptanceStatus_deletedAt_idx"
ON "support_list_memberships"("botId", "acceptanceStatus", "deletedAt");

-- CreateIndex
CREATE INDEX "support_list_memberships_settingsId_idx" ON "support_list_memberships"("settingsId");

-- CreateIndex
CREATE INDEX "support_list_memberships_addedByUserId_idx" ON "support_list_memberships"("addedByUserId");

-- CreateIndex
CREATE INDEX "support_list_memberships_channelTelegramId_idx" ON "support_list_memberships"("channelTelegramId");

-- CreateIndex
CREATE UNIQUE INDEX "support_list_cycles_botId_scheduledAt_key" ON "support_list_cycles"("botId", "scheduledAt");

-- CreateIndex
CREATE INDEX "support_list_cycles_status_scheduledAt_idx" ON "support_list_cycles"("status", "scheduledAt");

-- CreateIndex
CREATE INDEX "support_list_cycles_settingsId_idx" ON "support_list_cycles"("settingsId");

-- CreateIndex
CREATE UNIQUE INDEX "support_list_publications_cycleId_membershipId_key"
ON "support_list_publications"("cycleId", "membershipId");

-- CreateIndex
CREATE INDEX "support_list_publications_status_deleteAt_idx"
ON "support_list_publications"("status", "deleteAt");

-- AddForeignKey
ALTER TABLE "support_list_settings"
ADD CONSTRAINT "support_list_settings_botId_fkey"
FOREIGN KEY ("botId") REFERENCES "bots"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_list_memberships"
ADD CONSTRAINT "support_list_memberships_settingsId_fkey"
FOREIGN KEY ("settingsId") REFERENCES "support_list_settings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_list_memberships"
ADD CONSTRAINT "support_list_memberships_channelId_fkey"
FOREIGN KEY ("channelId") REFERENCES "channels"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_list_memberships"
ADD CONSTRAINT "support_list_memberships_addedByUserId_fkey"
FOREIGN KEY ("addedByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_list_cycles"
ADD CONSTRAINT "support_list_cycles_settingsId_fkey"
FOREIGN KEY ("settingsId") REFERENCES "support_list_settings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_list_publications"
ADD CONSTRAINT "support_list_publications_cycleId_fkey"
FOREIGN KEY ("cycleId") REFERENCES "support_list_cycles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_list_publications"
ADD CONSTRAINT "support_list_publications_membershipId_fkey"
FOREIGN KEY ("membershipId") REFERENCES "support_list_memberships"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
