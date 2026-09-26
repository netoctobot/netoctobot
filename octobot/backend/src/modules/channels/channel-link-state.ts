import type { Redis } from "ioredis";

const STATE_TTL_SECONDS = 10 * 60;

export interface ChannelLinkState {
  chatId: number;
}

export function channelLinkStateKey(
  botId: string,
  telegramUserId: number,
): string {
  return `bot:channel-link:${botId}:${telegramUserId}`;
}

export async function saveChannelLinkState(
  redis: Redis,
  botId: string,
  telegramUserId: number,
  state: ChannelLinkState,
): Promise<void> {
  await redis.set(
    channelLinkStateKey(botId, telegramUserId),
    JSON.stringify(state),
    "EX",
    STATE_TTL_SECONDS,
  );
}

export async function getChannelLinkState(
  redis: Redis,
  botId: string,
  telegramUserId: number,
): Promise<ChannelLinkState | null> {
  const value = await redis.get(
    channelLinkStateKey(botId, telegramUserId),
  );
  if (!value) {
    return null;
  }

  const parsed = JSON.parse(value) as Partial<ChannelLinkState>;
  if (typeof parsed.chatId !== "number") {
    await clearChannelLinkState(redis, botId, telegramUserId);
    return null;
  }

  return parsed as ChannelLinkState;
}

export async function clearChannelLinkState(
  redis: Redis,
  botId: string,
  telegramUserId: number,
): Promise<void> {
  await redis.del(channelLinkStateKey(botId, telegramUserId));
}
