-- CPM lab tables only. Does not alter wallets, ads, payments, withdrawals, or channel links.

-- CreateEnum
CREATE TYPE "CpmLabReaderKind" AS ENUM ('BOT_CHANNELS_GET_MESSAGES', 'USER_GET_MESSAGES_VIEWS');

-- CreateEnum
CREATE TYPE "CpmLabObservationSource" AS ENUM ('TELEGRAM', 'INJECTED');

-- CreateEnum
CREATE TYPE "CpmLabRunStatus" AS ENUM ('RUNNING', 'STOPPED');

-- CreateTable
CREATE TABLE "cpm_lab_runs" (
    "id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "status" "CpmLabRunStatus" NOT NULL DEFAULT 'RUNNING',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "stoppedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cpm_lab_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cpm_lab_channels" (
    "id" TEXT NOT NULL,
    "telegramChannelId" BIGINT NOT NULL,
    "title" TEXT,
    "isPrivate" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cpm_lab_channels_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cpm_lab_posts" (
    "id" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "telegramMessageId" BIGINT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cpm_lab_posts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cpm_lab_rpc_requests" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "reader" "CpmLabReaderKind" NOT NULL,
    "channelId" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "source" "CpmLabObservationSource" NOT NULL,
    "errorClass" TEXT,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cpm_lab_rpc_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cpm_lab_readings" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "telegramMessageId" BIGINT NOT NULL,
    "views" INTEGER,
    "observedAt" TIMESTAMP(3) NOT NULL,
    "source" "CpmLabObservationSource" NOT NULL,

    CONSTRAINT "cpm_lab_readings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cpm_lab_alerts" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "detail" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cpm_lab_alerts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cpm_lab_sessions" (
    "id" TEXT NOT NULL,
    "reader" "CpmLabReaderKind" NOT NULL,
    "keyVersion" INTEGER NOT NULL DEFAULT 1,
    "ciphertext" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cpm_lab_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "cpm_lab_channels_telegramChannelId_key" ON "cpm_lab_channels"("telegramChannelId");

-- CreateIndex
CREATE UNIQUE INDEX "cpm_lab_posts_channelId_telegramMessageId_key" ON "cpm_lab_posts"("channelId", "telegramMessageId");

-- CreateIndex
CREATE UNIQUE INDEX "cpm_lab_rpc_requests_runId_idempotencyKey_key" ON "cpm_lab_rpc_requests"("runId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "cpm_lab_rpc_requests_runId_reader_idx" ON "cpm_lab_rpc_requests"("runId", "reader");

-- CreateIndex
CREATE UNIQUE INDEX "cpm_lab_readings_requestId_channelId_telegramMessageId_key" ON "cpm_lab_readings"("requestId", "channelId", "telegramMessageId");

-- CreateIndex
CREATE INDEX "cpm_lab_readings_runId_channelId_telegramMessageId_idx" ON "cpm_lab_readings"("runId", "channelId", "telegramMessageId");

-- CreateIndex
CREATE INDEX "cpm_lab_alerts_runId_createdAt_idx" ON "cpm_lab_alerts"("runId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "cpm_lab_sessions_reader_key" ON "cpm_lab_sessions"("reader");

-- AddForeignKey
ALTER TABLE "cpm_lab_posts" ADD CONSTRAINT "cpm_lab_posts_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "cpm_lab_channels"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cpm_lab_rpc_requests" ADD CONSTRAINT "cpm_lab_rpc_requests_runId_fkey" FOREIGN KEY ("runId") REFERENCES "cpm_lab_runs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cpm_lab_rpc_requests" ADD CONSTRAINT "cpm_lab_rpc_requests_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "cpm_lab_channels"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cpm_lab_readings" ADD CONSTRAINT "cpm_lab_readings_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "cpm_lab_rpc_requests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cpm_lab_readings" ADD CONSTRAINT "cpm_lab_readings_runId_fkey" FOREIGN KEY ("runId") REFERENCES "cpm_lab_runs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cpm_lab_readings" ADD CONSTRAINT "cpm_lab_readings_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "cpm_lab_channels"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cpm_lab_readings" ADD CONSTRAINT "cpm_lab_readings_postId_fkey" FOREIGN KEY ("postId") REFERENCES "cpm_lab_posts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cpm_lab_alerts" ADD CONSTRAINT "cpm_lab_alerts_runId_fkey" FOREIGN KEY ("runId") REFERENCES "cpm_lab_runs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
