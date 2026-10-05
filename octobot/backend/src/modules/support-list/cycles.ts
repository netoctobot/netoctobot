import {
  SupportListCycleStatus,
  SupportListScheduleMode,
  type PrismaClient,
} from "@prisma/client";
import { HORIZON_DAYS } from "./constants.js";
import {
  addLocalDays,
  civilParts,
  defaultDayClocks,
  isValidTimeZone,
  localDateKey,
  readCustomTimes,
  validateCustomSchedule,
  zonedTimeToUtc,
} from "./schedule.js";

export async function skipFuturePendingCycles(
  prisma: PrismaClient,
  botId: string,
  now = new Date(),
): Promise<void> {
  await prisma.supportListCycle.updateMany({
    where: {
      botId,
      status: SupportListCycleStatus.PENDING,
      scheduledAt: { gt: now },
    },
    data: { status: SupportListCycleStatus.SKIPPED },
  });
}

export async function ensureSupportListHorizon(
  prisma: PrismaClient,
  now = new Date(),
): Promise<{ id: string; scheduledAt: Date }[]> {
  const bots = await prisma.bot.findMany({
    where: {
      botType: "SUPPORT_LIST_BOT",
      isActive: true,
      deletedAt: null,
      supportListSettings: { is: { publishingEnabled: true } },
    },
    include: { supportListSettings: true },
  });
  const cycles: { id: string; scheduledAt: Date }[] = [];
  for (const bot of bots) {
    const settings = bot.supportListSettings;
    if (!settings || !isValidTimeZone(settings.timeZone)) {
      continue;
    }
    const customTimes = readCustomTimes(settings.customTimes);
    if (settings.scheduleMode === SupportListScheduleMode.CUSTOM) {
      if (!validateCustomSchedule(customTimes, settings.retentionMinutes).ok) {
        continue;
      }
    }
    const horizonEnd = new Date(now.getTime() + HORIZON_DAYS * 24 * 60 * 60 * 1000);
    const existing = await prisma.supportListCycle.findMany({
      where: {
        botId: bot.id,
        scheduledAt: {
          gte: new Date(now.getTime() - 24 * 60 * 60 * 1000),
          lt: horizonEnd,
        },
      },
    });
    for (const cycle of existing) {
      if (cycle.status === SupportListCycleStatus.PENDING) {
        cycles.push({ id: cycle.id, scheduledAt: cycle.scheduledAt });
      }
    }
    const covered = new Set(
      existing
        .filter(
          (cycle) =>
            cycle.status !== SupportListCycleStatus.SKIPPED &&
            cycle.status !== SupportListCycleStatus.FAILED,
        )
        .map((cycle) => localDateKey(cycle.scheduledAt, settings.timeZone)),
    );
    const start = civilParts(now, settings.timeZone);
    let cursor = { year: start.year, month: start.month, day: start.day };
    for (let day = 0; day < HORIZON_DAYS; day += 1) {
      if (day > 0) {
        cursor = addLocalDays(cursor.year, cursor.month, cursor.day, 1);
      }
      const dayKey = [
        cursor.year,
        String(cursor.month).padStart(2, "0"),
        String(cursor.day).padStart(2, "0"),
      ].join("-");
      if (covered.has(dayKey)) {
        continue;
      }
      const clocks =
        settings.scheduleMode === SupportListScheduleMode.CUSTOM
          ? customTimes
          : defaultDayClocks(Math.random);
      for (const clock of clocks) {
        const scheduledAt = zonedTimeToUtc(
          cursor.year,
          cursor.month,
          cursor.day,
          clock.hour,
          clock.minute,
          settings.timeZone,
        );
        if (scheduledAt.getTime() <= now.getTime()) {
          continue;
        }
        if (localDateKey(scheduledAt, settings.timeZone) !== dayKey) {
          continue;
        }
        try {
          const created = await prisma.supportListCycle.create({
            data: {
              settingsId: settings.id,
              botId: bot.id,
              scheduledAt,
              deleteAt: new Date(
                scheduledAt.getTime() + settings.retentionMinutes * 60_000,
              ),
              rotationOffset: settings.rotationOffset,
              status: SupportListCycleStatus.PENDING,
            },
          });
          cycles.push({ id: created.id, scheduledAt: created.scheduledAt });
        } catch {
          // Another worker inserted the same instant.
        }
      }
      covered.add(dayKey);
    }
  }
  const seen = new Set<string>();
  return cycles.filter((cycle) => {
    if (seen.has(cycle.id)) {
      return false;
    }
    seen.add(cycle.id);
    return true;
  });
}
