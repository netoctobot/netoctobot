import type { Redis } from "ioredis";

const STATE_TTL_SECONDS = 10 * 60;

export interface ChannelLinkState {
  ownerId: string;
  botId: string;
  chatId: number;
  dashboardMessageId: number;
}

function stateKey(telegramUserId: number): string {
  return `platform:link-channel:${telegramUserId}`;
}

export async function saveChannelLinkState(
  redis: Redis,
  telegramUserId: number,
  state: ChannelLinkState,
): Promise<void> {
  await redis.set(
    stateKey(telegramUserId),
    JSON.stringify(state),
    "EX",
    STATE_TTL_SECONDS,
  );
}

export async function getChannelLinkState(
  redis: Redis,
  telegramUserId: number,
): Promise<ChannelLinkState | null> {
  const value = await redis.get(stateKey(telegramUserId));
  if (!value) {
    return null;
  }

  const parsed = JSON.parse(value) as Partial<ChannelLinkState>;
  if (
    typeof parsed.ownerId !== "string" ||
    typeof parsed.botId !== "string" ||
    typeof parsed.chatId !== "number" ||
    typeof parsed.dashboardMessageId !== "number"
  ) {
    await clearChannelLinkState(redis, telegramUserId);
    return null;
  }

  return parsed as ChannelLinkState;
}

export async function clearChannelLinkState(
  redis: Redis,
  telegramUserId: number,
): Promise<void> {
  await redis.del(stateKey(telegramUserId));
}
