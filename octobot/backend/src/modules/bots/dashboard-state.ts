import type { Redis } from "ioredis";

const DASHBOARD_TTL_SECONDS = 30 * 24 * 60 * 60;

export interface DashboardMessageState {
  chatId: number;
  messageId: number;
}

function dashboardKey(telegramUserId: number): string {
  return `platform:dashboard:${telegramUserId}`;
}

export async function saveDashboardState(
  redis: Redis,
  telegramUserId: number,
  state: DashboardMessageState,
): Promise<void> {
  await redis.set(
    dashboardKey(telegramUserId),
    JSON.stringify(state),
    "EX",
    DASHBOARD_TTL_SECONDS,
  );
}

export async function getDashboardState(
  redis: Redis,
  telegramUserId: number,
): Promise<DashboardMessageState | null> {
  const value = await redis.get(dashboardKey(telegramUserId));
  if (!value) {
    return null;
  }

  const parsed = JSON.parse(value) as Partial<DashboardMessageState>;
  if (
    typeof parsed.chatId !== "number" ||
    typeof parsed.messageId !== "number"
  ) {
    await clearDashboardState(redis, telegramUserId);
    return null;
  }

  return parsed as DashboardMessageState;
}

export async function clearDashboardState(
  redis: Redis,
  telegramUserId: number,
): Promise<void> {
  await redis.del(dashboardKey(telegramUserId));
}
