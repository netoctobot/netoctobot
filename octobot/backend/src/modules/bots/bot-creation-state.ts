import { BotType } from "@prisma/client";
import type { Redis } from "ioredis";

const STATE_TTL_SECONDS = 10 * 60;

export interface BotCreationState {
  ownerId: string;
  botType: Extract<BotType, "CONTACT_BOT" | "SUPPORT_LIST_BOT">;
  chatId: number;
  dashboardMessageId: number;
}

function stateKey(telegramUserId: number): string {
  return `platform:create-bot:${telegramUserId}`;
}

export async function saveBotCreationState(
  redis: Redis,
  telegramUserId: number,
  state: BotCreationState,
): Promise<void> {
  await redis.set(
    stateKey(telegramUserId),
    JSON.stringify(state),
    "EX",
    STATE_TTL_SECONDS,
  );
}

export async function getBotCreationState(
  redis: Redis,
  telegramUserId: number,
): Promise<BotCreationState | null> {
  const value = await redis.get(stateKey(telegramUserId));
  if (!value) {
    return null;
  }

  const parsed = JSON.parse(value) as Partial<BotCreationState>;
  if (
    typeof parsed.ownerId !== "string" ||
    (parsed.botType !== BotType.CONTACT_BOT &&
      parsed.botType !== BotType.SUPPORT_LIST_BOT) ||
    typeof parsed.chatId !== "number" ||
    typeof parsed.dashboardMessageId !== "number"
  ) {
    await clearBotCreationState(redis, telegramUserId);
    return null;
  }

  return parsed as BotCreationState;
}

export async function clearBotCreationState(
  redis: Redis,
  telegramUserId: number,
): Promise<void> {
  await redis.del(stateKey(telegramUserId));
}
