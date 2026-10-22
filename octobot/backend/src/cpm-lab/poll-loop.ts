import { TelegramPausedError, type AdvisorySessionLock } from "./lock.js";

export type PollLock = Pick<AdvisorySessionLock, "isHeld" | "probe">;

export async function runPollLoop<T>(input: {
  lock: PollLock;
  requests: readonly T[];
  transport: (request: T) => Promise<void>;
}): Promise<{ completed: number; stoppedReason: string | null }> {
  let completed = 0;
  for (const request of input.requests) {
    const held = await probeSafely(input.lock);
    if (!held) {
      return { completed, stoppedReason: "lock_lost" };
    }
    await input.transport(request);
    completed += 1;
  }
  return { completed, stoppedReason: null };
}

export function assertTelegramOpen(lock: Pick<AdvisorySessionLock, "isHeld">): void {
  if (!lock.isHeld()) {
    throw new TelegramPausedError("lock_lost");
  }
}

async function probeSafely(lock: PollLock): Promise<boolean> {
  if (!lock.isHeld()) {
    return false;
  }
  try {
    return await lock.probe();
  } catch {
    return false;
  }
}
