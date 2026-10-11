-- CreateEnum
CREATE TYPE "BroadcastMessageDeleteStatus" AS ENUM ('NONE', 'PENDING', 'IN_PROGRESS', 'DELETED', 'GONE', 'UNAVAILABLE');

-- AlterTable
ALTER TABLE "broadcast_campaigns" ADD COLUMN "deleteRequested" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "broadcast_delivery_messages" ADD COLUMN "deleteStatus" "BroadcastMessageDeleteStatus" NOT NULL DEFAULT 'NONE';
ALTER TABLE "broadcast_delivery_messages" ADD COLUMN "deleteReason" TEXT;
ALTER TABLE "broadcast_delivery_messages" ADD COLUMN "deletedAt" TIMESTAMP(3);
ALTER TABLE "broadcast_delivery_messages" ADD COLUMN "deleteSettledAt" TIMESTAMP(3);
ALTER TABLE "broadcast_delivery_messages" ADD COLUMN "deleteLeaseExpiresAt" TIMESTAMP(3);
ALTER TABLE "broadcast_delivery_messages" ADD COLUMN "deleteAttempts" INTEGER NOT NULL DEFAULT 0;

CREATE INDEX "broadcast_delivery_messages_deleteStatus_idx" ON "broadcast_delivery_messages"("deleteStatus");
