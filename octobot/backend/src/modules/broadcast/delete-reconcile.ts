import type { PrismaClient } from "@prisma/client";
import { markMessageDeletePending } from "./delete-claim.js";

export async function ensureLegacyMessageRow(
  prisma: PrismaClient,
  deliveryId: string,
): Promise<string | null> {
  const delivery = await prisma.broadcastDelivery.findUnique({
    where: { id: deliveryId },
    select: {
      id: true,
      status: true,
      telegramMessageId: true,
      recipientTelegramChatId: true,
      messages: { select: { id: true }, take: 1 },
    },
  });
  if (!delivery || delivery.status !== "SENT") {
    return null;
  }
  if (delivery.messages.length > 0) {
    return delivery.messages[0].id;
  }
  if (delivery.telegramMessageId === null || delivery.recipientTelegramChatId === null) {
    return null;
  }
  const created = await prisma.broadcastDeliveryMessage.create({
    data: {
      deliveryId: delivery.id,
      telegramMessageId: delivery.telegramMessageId,
      sortOrder: 0,
    },
    select: { id: true },
  });
  return created.id;
}

export async function queueDeleteForSentDelivery(
  prisma: PrismaClient,
  deliveryId: string,
): Promise<string | null> {
  const messageId = await ensureLegacyMessageRow(prisma, deliveryId);
  if (!messageId) {
    return null;
  }
  await markMessageDeletePending(prisma, messageId);
  return messageId;
}

export async function findMessagesNeedingDeleteQueue(prisma: PrismaClient): Promise<string[]> {
  const rows = await prisma.broadcastDeliveryMessage.findMany({
    where: {
      deleteStatus: { in: ["NONE", "PENDING"] },
      delivery: {
        status: "SENT",
        campaign: { deleteRequested: true },
      },
    },
    select: { id: true, deleteStatus: true },
    take: 500,
  });
  const ids: string[] = [];
  for (const row of rows) {
    if (row.deleteStatus === "NONE") {
      const ok = await markMessageDeletePending(prisma, row.id);
      if (ok) {
        ids.push(row.id);
      }
    } else {
      ids.push(row.id);
    }
  }
  return ids;
}

export async function findPendingDeleteMessageIds(prisma: PrismaClient): Promise<string[]> {
  const rows = await prisma.broadcastDeliveryMessage.findMany({
    where: { deleteStatus: "PENDING" },
    select: { id: true },
    take: 1000,
  });
  return rows.map((row) => row.id);
}
