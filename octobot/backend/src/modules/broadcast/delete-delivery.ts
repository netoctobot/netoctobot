import { Api, GrammyError } from "grammy";
import type { PrismaClient, BroadcastMessageDeleteStatus } from "@prisma/client";
import { decryptToken } from "../../lib/token-crypto.js";
import { claimMessageForDelete, releaseClaimToPending } from "./delete-claim.js";

export const DELETE_LEASE_MS = 5 * 60 * 1000;
export const MAX_DELETE_ATTEMPTS = 8;

export type DeleteErrorClassification =
  | { action: "deleted" }
  | { action: "gone"; reason: string }
  | { action: "unavailable"; reason: string }
  | { action: "retry"; delayMs: number };

export function classifyDeleteError(error: unknown): DeleteErrorClassification {
  if (error instanceof GrammyError) {
    const description = error.description.toLowerCase();
    if (error.error_code === 429) {
      const retryAfter = error.parameters?.retry_after;
      return {
        action: "retry",
        delayMs: (retryAfter && retryAfter > 0 ? retryAfter : 1) * 1000,
      };
    }
    if (
      description.includes("message to delete not found") ||
      description.includes("message identifier is not specified")
    ) {
      return { action: "gone", reason: "message_not_found" };
    }
    if (description.includes("message can't be deleted")) {
      return { action: "unavailable", reason: "cannot_delete" };
    }
    if (error.error_code === 403 || error.error_code === 400) {
      return { action: "unavailable", reason: "telegram_rejected" };
    }
  }
  if (error instanceof Error && /timed out|econnreset|fetch failed/i.test(error.message)) {
    return { action: "retry", delayMs: 2000 };
  }
  return { action: "unavailable", reason: "unknown" };
}

export interface ResolvedDeleteTarget {
  chatId: number;
  messageId: number;
  botId: string;
  tokenEncrypted: string;
}

export function resolveDeleteTarget(input: {
  delivery: {
    status: string;
    botId: string | null;
    telegramMessageId: bigint | null;
    recipientTelegramChatId: bigint | null;
    bot: { tokenEncrypted: string } | null;
  };
  message: { telegramMessageId: bigint };
}): ResolvedDeleteTarget | { error: string } {
  if (input.delivery.status !== "SENT") {
    return { error: "delivery_not_sent" };
  }
  if (!input.delivery.botId || !input.delivery.bot?.tokenEncrypted) {
    return { error: "missing_sender_bot" };
  }
  const chatId = input.delivery.recipientTelegramChatId;
  if (chatId === null) {
    return { error: "missing_chat_id" };
  }
  const messageId = input.message.telegramMessageId;
  if (messageId === null || messageId === undefined) {
    return { error: "missing_message_id" };
  }
  return {
    chatId: Number(chatId),
    messageId: Number(messageId),
    botId: input.delivery.botId,
    tokenEncrypted: input.delivery.bot.tokenEncrypted,
  };
}

async function finalizeDeleteStatus(
  prisma: PrismaClient,
  messageRowId: string,
  status: BroadcastMessageDeleteStatus,
  input: { reason?: string; deletedAt?: Date; deleteSettledAt?: Date },
): Promise<void> {
  await prisma.broadcastDeliveryMessage.update({
    where: { id: messageRowId },
    data: {
      deleteStatus: status,
      deleteReason: input.reason ?? null,
      deletedAt: input.deletedAt ?? null,
      deleteSettledAt: input.deleteSettledAt ?? null,
      deleteLeaseExpiresAt: null,
    },
  });
}

export async function executeBroadcastMessageDelete(input: {
  prisma: PrismaClient;
  encryptionKey: string;
  messageRowId: string;
  apiFactory?: (token: string) => Api;
  now?: Date;
}): Promise<"done" | "retry" | "skipped"> {
  const now = input.now ?? new Date();
  const claimed = await claimMessageForDelete(input.prisma, input.messageRowId, now);
  if (!claimed) {
    return "skipped";
  }

  const row = await input.prisma.broadcastDeliveryMessage.findUnique({
    where: { id: input.messageRowId },
    select: {
      id: true,
      deleteAttempts: true,
      telegramMessageId: true,
      delivery: {
        select: {
          status: true,
          botId: true,
          telegramMessageId: true,
          recipientTelegramChatId: true,
          bot: { select: { tokenEncrypted: true } },
        },
      },
    },
  });
  if (!row) {
    return "skipped";
  }

  const resolved = resolveDeleteTarget({ delivery: row.delivery, message: row });
  if ("error" in resolved) {
    await finalizeDeleteStatus(input.prisma, row.id, "UNAVAILABLE", {
      reason: resolved.error,
      deleteSettledAt: now,
    });
    return "done";
  }

  let token: string;
  try {
    token = decryptToken(resolved.tokenEncrypted, input.encryptionKey);
  } catch {
    await finalizeDeleteStatus(input.prisma, row.id, "UNAVAILABLE", {
      reason: "invalid_token",
      deleteSettledAt: now,
    });
    return "done";
  }

  const api = input.apiFactory ? input.apiFactory(token) : new Api(token);

  try {
    await api.deleteMessage(resolved.chatId, resolved.messageId);
    await finalizeDeleteStatus(input.prisma, row.id, "DELETED", {
      deletedAt: now,
    });
    return "done";
  } catch (error) {
    const classified = classifyDeleteError(error);
    if (classified.action === "retry") {
      if (row.deleteAttempts >= MAX_DELETE_ATTEMPTS) {
        await finalizeDeleteStatus(input.prisma, row.id, "UNAVAILABLE", {
          reason: "max_attempts",
          deleteSettledAt: now,
        });
        return "done";
      }
      await releaseClaimToPending(input.prisma, row.id);
      return "retry";
    }
    if (classified.action === "gone") {
      await finalizeDeleteStatus(input.prisma, row.id, "GONE", {
        reason: classified.reason,
        deleteSettledAt: now,
      });
      return "done";
    }
    await finalizeDeleteStatus(input.prisma, row.id, "UNAVAILABLE", {
      reason: classified.action === "unavailable" ? classified.reason : "unknown",
      deleteSettledAt: now,
    });
    return "done";
  }
}
