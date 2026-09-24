import type { Redis } from "ioredis";

const DASHBOARD_TTL_SECONDS = 30 * 24 * 60 * 60;

export interface DashboardMessageState {
  chatId: number;
  messageId: number;
}

export function dashboardStateKey(
  botId: string,
  telegramUserId: number,
): string {
  return `bot:dashboard:${botId}:${telegramUserId}`;
}

export async function saveDashboardState(
  redis: Redis,
  botId: string,
  telegramUserId: number,
  state: DashboardMessageState,
): Promise<void> {
  await redis.set(
    dashboardStateKey(botId, telegramUserId),
    JSON.stringify(state),
    "EX",
    DASHBOARD_TTL_SECONDS,
  );
}

export async function getDashboardState(
  redis: Redis,
  botId: string,
  telegramUserId: number,
): Promise<DashboardMessageState | null> {
  const value = await redis.get(
    dashboardStateKey(botId, telegramUserId),
  );
  if (!value) {
    return null;
  }

  const parsed = JSON.parse(value) as Partial<DashboardMessageState>;
  if (
    typeof parsed.chatId !== "number" ||
    typeof parsed.messageId !== "number"
  ) {
    await clearDashboardState(redis, botId, telegramUserId);
    return null;
  }

  return parsed as DashboardMessageState;
}

export async function clearDashboardState(
  redis: Redis,
  botId: string,
  telegramUserId: number,
): Promise<void> {
  await redis.del(dashboardStateKey(botId, telegramUserId));
}
