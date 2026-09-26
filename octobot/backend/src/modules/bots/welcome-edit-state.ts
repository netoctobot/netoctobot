import { SupportedLanguage } from "@prisma/client";
import type { Redis } from "ioredis";
import { parseSupportedLanguage } from "../localization/supported-languages.js";

const STATE_TTL_SECONDS = 10 * 60;

export interface WelcomeEditState {
  chatId: number;
  dashboardMessageId: number;
  language: SupportedLanguage;
}

export function welcomeEditStateKey(
  botId: string,
  telegramUserId: number,
): string {
  return `bot:welcome-edit:${botId}:${telegramUserId}`;
}

export async function saveWelcomeEditState(
  redis: Redis,
  botId: string,
  telegramUserId: number,
  state: WelcomeEditState,
): Promise<void> {
  await redis.set(
    welcomeEditStateKey(botId, telegramUserId),
    JSON.stringify(state),
    "EX",
    STATE_TTL_SECONDS,
  );
}

export async function getWelcomeEditState(
  redis: Redis,
  botId: string,
  telegramUserId: number,
): Promise<WelcomeEditState | null> {
  const value = await redis.get(
    welcomeEditStateKey(botId, telegramUserId),
  );
  if (!value) {
    return null;
  }
  const parsed = JSON.parse(value) as Partial<WelcomeEditState>;
  const language =
    typeof parsed.language === "string"
      ? parseSupportedLanguage(parsed.language)
      : null;
  if (
    typeof parsed.chatId !== "number" ||
    typeof parsed.dashboardMessageId !== "number" ||
    language === null
  ) {
    await clearWelcomeEditState(redis, botId, telegramUserId);
    return null;
  }
  return {
    chatId: parsed.chatId,
    dashboardMessageId: parsed.dashboardMessageId,
    language,
  };
}

export async function clearWelcomeEditState(
  redis: Redis,
  botId: string,
  telegramUserId: number,
): Promise<void> {
  await redis.del(
    welcomeEditStateKey(botId, telegramUserId),
  );
}
