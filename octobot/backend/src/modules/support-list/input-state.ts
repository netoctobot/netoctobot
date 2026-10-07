import type { Redis } from "ioredis";

const TTL_SECONDS = 600;

export type SupportListDraft =
  | {
      kind: "listName" | "contactUrl" | "timeZone";
      chatId: number;
      dashboardMessageId: number;
    }
  | {
      kind: "slotTime";
      chatId: number;
      dashboardMessageId: number;
      index: number | null;
    }
  | {
      kind: "slotKeep";
      chatId: number;
      dashboardMessageId: number;
      index: number | null;
      time: string;
    }
  | {
      kind: "adminReason";
      chatId: number;
      dashboardMessageId: number;
      membershipId: string;
      page: number;
      scope: string;
    };

function key(botId: string, telegramUserId: number): string {
  return `bot:support-list-input:${botId}:${telegramUserId}`;
}

export async function saveSupportListDraft(
  redis: Redis,
  botId: string,
  telegramUserId: number,
  draft: SupportListDraft,
): Promise<void> {
  await redis.set(
    key(botId, telegramUserId),
    JSON.stringify(draft),
    "EX",
    TTL_SECONDS,
  );
}

export async function getSupportListDraft(
  redis: Redis,
  botId: string,
  telegramUserId: number,
): Promise<SupportListDraft | null> {
  const value = await redis.get(key(botId, telegramUserId));
  if (!value) {
    return null;
  }
  const parsed = JSON.parse(value) as SupportListDraft;
  if (!parsed || typeof parsed !== "object" || !parsed.kind) {
    return null;
  }
  return parsed;
}

export async function clearSupportListDraft(
  redis: Redis,
  botId: string,
  telegramUserId: number,
): Promise<void> {
  await redis.del(key(botId, telegramUserId));
}
