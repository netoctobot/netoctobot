import {
  CYCLE_GAP_MINUTES,
  DEFAULT_RETENTION_MINUTES,
  HORIZON_DAYS,
  MAX_CUSTOM_TIMES,
  MAX_RETENTION_MINUTES,
  MIN_RETENTION_MINUTES,
} from "./constants.js";

export interface CivilTime {
  hour: number;
  minute: number;
}

export type ScheduleRejection =
  | "count"
  | "retention"
  | "overlap"
  | "duplicate";

export interface PlannedSlot {
  scheduledAt: Date;
  deleteAt: Date;
}

function partValue(
  parts: Intl.DateTimeFormatPart[],
  type: Intl.DateTimeFormatPartTypes,
): number {
  const raw = Number(parts.find((part) => part.type === type)?.value);
  if (type === "hour" && raw === 24) {
    return 0;
  }
  return raw;
}

export function isValidTimeZone(timeZone: string): boolean {
  if (!timeZone || timeZone.length > 80) {
    return false;
  }
  try {
    Intl.DateTimeFormat("en-US", { timeZone }).format(0);
    return true;
  } catch {
    return false;
  }
}

export function civilParts(
  date: Date,
  timeZone: string,
): {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
} {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(date);
  return {
    year: partValue(parts, "year"),
    month: partValue(parts, "month"),
    day: partValue(parts, "day"),
    hour: partValue(parts, "hour"),
    minute: partValue(parts, "minute"),
  };
}

export function localDateKey(date: Date, timeZone: string): string {
  const parts = civilParts(date, timeZone);
  return [
    parts.year,
    String(parts.month).padStart(2, "0"),
    String(parts.day).padStart(2, "0"),
  ].join("-");
}

export function timeZoneOffsetMinutes(
  date: Date,
  timeZone: string,
): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(date);
  const asUtc = Date.UTC(
    partValue(parts, "year"),
    partValue(parts, "month") - 1,
    partValue(parts, "day"),
    partValue(parts, "hour"),
    partValue(parts, "minute"),
    partValue(parts, "second"),
  );
  return Math.round((asUtc - date.getTime()) / 60_000);
}

export function zonedTimeToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  timeZone: string,
): Date {
  const utcGuess = Date.UTC(year, month - 1, day, hour, minute, 0);
  const offset = timeZoneOffsetMinutes(new Date(utcGuess), timeZone);
  let utc = utcGuess - offset * 60_000;
  const corrected = timeZoneOffsetMinutes(new Date(utc), timeZone);
  if (corrected !== offset) {
    utc = utcGuess - corrected * 60_000;
  }
  return new Date(utc);
}

export function addLocalDays(
  year: number,
  month: number,
  day: number,
  days: number,
): { year: number; month: number; day: number } {
  const shifted = new Date(Date.UTC(year, month - 1, day + days));
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
  };
}

export function formatInTimeZone(date: Date, timeZone: string): string {
  const parts = civilParts(date, timeZone);
  return `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")} ${String(parts.hour).padStart(2, "0")}:${String(parts.minute).padStart(2, "0")}`;
}

export function parseClock(value: string): CivilTime | null {
  const match = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(value.trim());
  if (!match?.[1] || !match[2]) {
    return null;
  }
  return { hour: Number(match[1]), minute: Number(match[2]) };
}

export function formatClock(time: CivilTime): string {
  return `${String(time.hour).padStart(2, "0")}:${String(time.minute).padStart(2, "0")}`;
}

export function parseClockList(text: string): CivilTime[] | null {
  const parts = text
    .split(/[\s,;]+/)
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length < 1 || parts.length > MAX_CUSTOM_TIMES) {
    return null;
  }
  const times: CivilTime[] = [];
  for (const part of parts) {
    const parsed = parseClock(part);
    if (!parsed) {
      return null;
    }
    times.push(parsed);
  }
  return times;
}

export function readCustomTimes(value: unknown): CivilTime[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const times: CivilTime[] = [];
  for (const item of value) {
    if (typeof item !== "string") {
      continue;
    }
    const parsed = parseClock(item);
    if (parsed) {
      times.push(parsed);
    }
  }
  return times;
}

function minutesOfDay(time: CivilTime): number {
  return time.hour * 60 + time.minute;
}

export function validateCustomSchedule(
  times: CivilTime[],
  retentionMinutes: number,
): { ok: true } | { ok: false; reason: ScheduleRejection } {
  if (times.length < 1 || times.length > MAX_CUSTOM_TIMES) {
    return { ok: false, reason: "count" };
  }
  if (
    !Number.isInteger(retentionMinutes) ||
    retentionMinutes < MIN_RETENTION_MINUTES ||
    retentionMinutes > MAX_RETENTION_MINUTES
  ) {
    return { ok: false, reason: "retention" };
  }
  const minutes = times.map(minutesOfDay).sort((left, right) => left - right);
  for (let index = 1; index < minutes.length; index += 1) {
    if (minutes[index] === minutes[index - 1]) {
      return { ok: false, reason: "duplicate" };
    }
  }
  const requiredGap = retentionMinutes + CYCLE_GAP_MINUTES;
  const points = [...minutes, (minutes[0] ?? 0) + 24 * 60];
  for (let index = 1; index < points.length; index += 1) {
    if ((points[index] ?? 0) - (points[index - 1] ?? 0) < requiredGap) {
      return { ok: false, reason: "overlap" };
    }
  }
  return { ok: true };
}

export function defaultDayClocks(
  random: () => number,
): [CivilTime, CivilTime] {
  const morning = 8 * 60 + Math.floor(random() * 180);
  const evening = 17 * 60 + Math.floor(random() * 180);
  return [
    { hour: Math.floor(morning / 60), minute: morning % 60 },
    { hour: Math.floor(evening / 60), minute: evening % 60 },
  ];
}

export function slotsForHorizon(input: {
  from: Date;
  timeZone: string;
  days?: number;
  retentionMinutes?: number;
  clocksForDay: (dayIndex: number) => CivilTime[];
}): PlannedSlot[] {
  const days = input.days ?? HORIZON_DAYS;
  const retention = input.retentionMinutes ?? DEFAULT_RETENTION_MINUTES;
  const start = civilParts(input.from, input.timeZone);
  let cursor = {
    year: start.year,
    month: start.month,
    day: start.day,
  };
  const slots: PlannedSlot[] = [];
  for (let day = 0; day < days; day += 1) {
    if (day > 0) {
      cursor = addLocalDays(cursor.year, cursor.month, cursor.day, 1);
    }
    for (const clock of input.clocksForDay(day)) {
      const scheduledAt = zonedTimeToUtc(
        cursor.year,
        cursor.month,
        cursor.day,
        clock.hour,
        clock.minute,
        input.timeZone,
      );
      if (scheduledAt.getTime() <= input.from.getTime()) {
        continue;
      }
      slots.push({
        scheduledAt,
        deleteAt: new Date(scheduledAt.getTime() + retention * 60_000),
      });
    }
  }
  return slots;
}

export function isStaleCycle(
  scheduledAt: Date,
  deleteAt: Date,
  now: Date,
): boolean {
  return deleteAt.getTime() <= now.getTime() && scheduledAt.getTime() < now.getTime();
}
