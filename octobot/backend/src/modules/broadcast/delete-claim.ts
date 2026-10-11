import type { PrismaClient } from "@prisma/client";
import { DELETE_LEASE_MS } from "./delete-delivery.js";

export async function claimMessageForDelete(
  prisma: PrismaClient,
  messageRowId: string,
  now = new Date(),
): Promise<boolean> {
  const leaseUntil = new Date(now.getTime() + DELETE_LEASE_MS);
  const result = await prisma.broadcastDeliveryMessage.updateMany({
    where: {
      id: messageRowId,
      OR: [
        { deleteStatus: "PENDING" },
        {
          deleteStatus: "IN_PROGRESS",
          deleteLeaseExpiresAt: { lt: now },
        },
      ],
    },
    data: {
      deleteStatus: "IN_PROGRESS",
      deleteLeaseExpiresAt: leaseUntil,
      deleteAttempts: { increment: 1 },
    },
  });
  return result.count === 1;
}

export async function releaseClaimToPending(
  prisma: PrismaClient,
  messageRowId: string,
): Promise<void> {
  await prisma.broadcastDeliveryMessage.updateMany({
    where: { id: messageRowId, deleteStatus: "IN_PROGRESS" },
    data: {
      deleteStatus: "PENDING",
      deleteLeaseExpiresAt: null,
    },
  });
}

export async function markMessageDeletePending(
  prisma: PrismaClient,
  messageRowId: string,
): Promise<boolean> {
  const result = await prisma.broadcastDeliveryMessage.updateMany({
    where: {
      id: messageRowId,
      deleteStatus: { in: ["NONE", "PENDING"] },
    },
    data: {
      deleteStatus: "PENDING",
      deleteLeaseExpiresAt: null,
    },
  });
  return result.count === 1;
}
