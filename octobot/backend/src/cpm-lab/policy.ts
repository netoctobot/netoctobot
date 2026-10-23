import type { LabErrorClass } from "./errors.js";

/** Fixed lab limits. Settings cannot raise them. */
export const LAB_LIMITS = {
  minSpacingMs: 3_000,
  maxRequestsPerRun: 200,
  retryDelayMs: 30_000,
  perCallTimeoutMs: 20_000,
  floodStopSeconds: 3_600,
  floodStopCount: 3,
  floodWindowMs: 24 * 60 * 60 * 1000,
  minIntervalMs: 60_000,
  maxRounds: 24,
} as const;

export type ErrorAction = "retry_once" | "skip_slot" | "stop_reader" | "stop_run";

const RETRYABLE: ReadonlySet<LabErrorClass> = new Set(["TIMEOUT", "NETWORK", "INTERNAL"]);
const STOPS_READER: ReadonlySet<LabErrorClass> = new Set([
  "AUTH_KEY_DUPLICATED",
  "SESSION_REVOKED",
  "USER_DEACTIVATED",
  "FROZEN",
]);

/**
 * FLOOD_WAIT never retries. The wait is persisted as nextAllowedAt and later
 * slots honor it. Configuration and integrity failures stop the whole run.
 */
export function actionForError(errorClass: LabErrorClass, isRetry: boolean): ErrorAction {
  if (errorClass === "FLOOD_WAIT") {
    return "skip_slot";
  }
  if (RETRYABLE.has(errorClass)) {
    return isRetry ? "skip_slot" : "retry_once";
  }
  if (STOPS_READER.has(errorClass)) {
    return "stop_reader";
  }
  return "stop_run";
}

/**
 * The window is the last 24 hours, rolling, per reader, counted from stored
 * flood events. The third event inside the window stops the reader, and so
 * does any single wait longer than one hour.
 */
export function floodDecision(input: {
  priorEventsInWindow: number;
  seconds: number;
}): { stopReader: boolean; reason: string | null } {
  if (input.seconds > LAB_LIMITS.floodStopSeconds) {
    return { stopReader: true, reason: "flood_wait_over_one_hour" };
  }
  if (input.priorEventsInWindow + 1 >= LAB_LIMITS.floodStopCount) {
    return { stopReader: true, reason: "third_flood_wait_in_24h" };
  }
  return { stopReader: false, reason: null };
}

export type ScheduledRound = {
  index: number;
  dueAt: Date;
  deadline: Date;
};

export function buildSchedule(input: {
  startAt: Date;
  rounds: number;
  intervalMs: number;
}): ScheduledRound[] {
  const rounds: ScheduledRound[] = [];
  for (let index = 0; index < input.rounds; index += 1) {
    const due = input.startAt.getTime() + index * input.intervalMs;
    rounds.push({
      index,
      dueAt: new Date(due),
      deadline: new Date(due + input.intervalMs),
    });
  }
  return rounds;
}

export type SkipReason = "deadline" | "flood_wait" | "late";

/**
 * A slot is sent at the latest of the current time, its due time, the
 * persisted nextAllowedAt, and 3 seconds after the last request by the same
 * lab. A slot whose send time reaches its round deadline is skipped. Nothing
 * is carried to later rounds. The worker calls this again after every wait.
 */
export function plannedSendTime(input: {
  now: Date;
  dueAt: Date;
  deadline: Date;
  nextAllowedAt: Date | null;
  lastRequestedAt: Date | null;
}): { sendAt: Date; skip: boolean; reason: SkipReason | null } {
  const deadline = input.deadline.getTime();
  const nowAt = input.now.getTime();
  const spacingAt = input.lastRequestedAt ? input.lastRequestedAt.getTime() + LAB_LIMITS.minSpacingMs : 0;
  const floodAt = input.nextAllowedAt?.getTime() ?? 0;
  const sendAt = Math.max(nowAt, input.dueAt.getTime(), spacingAt, floodAt);
  if (sendAt < deadline) {
    return { sendAt: new Date(sendAt), skip: false, reason: null };
  }
  const reason: SkipReason = nowAt >= deadline ? "deadline" : floodAt >= deadline ? "flood_wait" : "late";
  return { sendAt: new Date(sendAt), skip: true, reason };
}

export function requestKey(parts: {
  purpose: "trial" | "preflight" | "peer";
  reader: string;
  round?: number;
  retry?: boolean;
}): string {
  const base =
    parts.purpose === "trial"
      ? `trial:r${parts.round ?? 0}:${parts.reader}`
      : `${parts.purpose}:${parts.reader}`;
  return parts.retry ? `${base}:retry1` : base;
}
