-- CPM lab A2. Additive only. The A1 migration is unchanged.
-- Does not alter wallets, ads, payments, withdrawals, or channel links.

-- CreateEnum
CREATE TYPE "CpmLabRunKind" AS ENUM ('PREFLIGHT', 'TRIAL');

-- CreateEnum
CREATE TYPE "CpmLabRequestStatus" AS ENUM ('STARTED', 'SUCCEEDED', 'FAILED', 'ABANDONED');

-- CreateEnum
CREATE TYPE "CpmLabRequestPurpose" AS ENUM ('TRIAL_READ', 'PREFLIGHT_READ', 'RETRY', 'PEER_RESOLUTION');

-- CreateEnum
CREATE TYPE "CpmLabResultKind" AS ENUM ('MESSAGE', 'MESSAGE_EMPTY', 'VIEWS_ABSENT');

-- AlterTable
ALTER TABLE "cpm_lab_readings" ADD COLUMN     "resultKind" "CpmLabResultKind" NOT NULL DEFAULT 'MESSAGE';

-- AlterTable
ALTER TABLE "cpm_lab_rpc_requests" ADD COLUMN     "durationMs" INTEGER,
ADD COLUMN     "finishedAt" TIMESTAMP(3),
ADD COLUMN     "floodWaitSeconds" INTEGER,
ADD COLUMN     "purpose" "CpmLabRequestPurpose" NOT NULL DEFAULT 'TRIAL_READ',
ADD COLUMN     "retryOfId" TEXT,
ADD COLUMN     "rpcMethod" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "slotIndex" INTEGER,
ADD COLUMN     "status" "CpmLabRequestStatus" NOT NULL DEFAULT 'STARTED';

-- AlterTable
ALTER TABLE "cpm_lab_runs" ADD COLUMN     "kind" "CpmLabRunKind" NOT NULL DEFAULT 'TRIAL',
ADD COLUMN     "libraryTraffic" JSONB,
ADD COLUMN     "settings" JSONB,
ADD COLUMN     "stopReason" TEXT;

-- CreateTable
CREATE TABLE "cpm_lab_reader_states" (
    "reader" "CpmLabReaderKind" NOT NULL,
    "nextAllowedAt" TIMESTAMP(3),
    "stoppedAt" TIMESTAMP(3),
    "stopReason" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cpm_lab_reader_states_pkey" PRIMARY KEY ("reader")
);

-- CreateTable
CREATE TABLE "cpm_lab_flood_events" (
    "id" TEXT NOT NULL,
    "reader" "CpmLabReaderKind" NOT NULL,
    "runId" TEXT,
    "requestId" TEXT,
    "seconds" INTEGER NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "nextAllowedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cpm_lab_flood_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cpm_lab_manual_events" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cpm_lab_manual_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "cpm_lab_flood_events_reader_occurredAt_idx" ON "cpm_lab_flood_events"("reader", "occurredAt");

-- CreateIndex
CREATE INDEX "cpm_lab_manual_events_runId_occurredAt_idx" ON "cpm_lab_manual_events"("runId", "occurredAt");

-- AddForeignKey
ALTER TABLE "cpm_lab_rpc_requests" ADD CONSTRAINT "cpm_lab_rpc_requests_retryOfId_fkey" FOREIGN KEY ("retryOfId") REFERENCES "cpm_lab_rpc_requests"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cpm_lab_flood_events" ADD CONSTRAINT "cpm_lab_flood_events_runId_fkey" FOREIGN KEY ("runId") REFERENCES "cpm_lab_runs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cpm_lab_flood_events" ADD CONSTRAINT "cpm_lab_flood_events_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "cpm_lab_rpc_requests"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cpm_lab_manual_events" ADD CONSTRAINT "cpm_lab_manual_events_runId_fkey" FOREIGN KEY ("runId") REFERENCES "cpm_lab_runs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Readings and flood events are append-only. Deletion stays with a later retention task.
CREATE FUNCTION "cpm_lab_reject_update"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'CPM lab table % is append-only', TG_TABLE_NAME
    USING ERRCODE = 'restrict_violation';
END;
$$;

CREATE TRIGGER "cpm_lab_readings_append_only"
BEFORE UPDATE ON "cpm_lab_readings"
FOR EACH ROW EXECUTE FUNCTION "cpm_lab_reject_update"();

CREATE TRIGGER "cpm_lab_flood_events_append_only"
BEFORE UPDATE ON "cpm_lab_flood_events"
FOR EACH ROW EXECUTE FUNCTION "cpm_lab_reject_update"();
