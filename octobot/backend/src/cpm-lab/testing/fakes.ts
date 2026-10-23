import type { ParsedObservation, ReaderTransport } from "../readers.js";
import type { LabReader } from "../types.js";
import type { LabClock, WorkerLock } from "../worker.js";

export class FakeClock implements LabClock {
  constructor(public time = Date.parse("2026-10-24T06:00:00.000Z")) {}
  stopAfterSleeps: number | null = null;
  sleeps = 0;
  /** Each wake-up lands this many ms after the requested time, like a suspended host. */
  oversleepMs = 0;
  /** Extra jump applied once on the next wake-up only. */
  nextWakeJumpMs = 0;

  now(): Date {
    return new Date(this.time);
  }

  async sleepUntil(at: Date, stop: AbortSignal): Promise<boolean> {
    if (stop.aborted) return false;
    this.sleeps += 1;
    if (this.stopAfterSleeps !== null && this.sleeps > this.stopAfterSleeps) return false;
    if (at.getTime() > this.time) this.time = at.getTime();
    this.time += this.oversleepMs + this.nextWakeJumpMs;
    this.nextWakeJumpMs = 0;
    return true;
  }

  advance(ms: number): void {
    this.time += ms;
  }
}

export class FakeLock implements WorkerLock {
  held = true;
  probes = 0;
  private readonly listeners: Array<() => void> = [];

  isHeld(): boolean {
    return this.held;
  }

  async probe(): Promise<boolean> {
    this.probes += 1;
    return this.held;
  }

  onLost(listener: () => void): void {
    this.listeners.push(listener);
  }

  lose(): void {
    this.held = false;
    for (const listener of this.listeners) listener();
  }
}

export type ScriptStep =
  | { views: number | null }
  | { error: unknown }
  | { run: (signal: AbortSignal) => Promise<ParsedObservation[]> };

/** Each call takes the next step, or succeeds with `fallbackViews` when the script is empty. */
export class ScriptedTransport implements ReaderTransport {
  readonly resolveMethod = "fake.Resolve";
  readonly readMethod = "fake.Read";
  readonly calls: Array<{ kind: "resolve" | "read"; at: number }> = [];
  resolveScript: ScriptStep[] = [];
  readScript: ScriptStep[] = [];
  fallbackViews = 10;
  latencyMs = 200;

  constructor(
    readonly reader: LabReader,
    private readonly clock: FakeClock,
  ) {}

  async resolve(signal: AbortSignal): Promise<void> {
    this.calls.push({ kind: "resolve", at: this.clock.time });
    await this.step(this.resolveScript.shift(), signal, []);
  }

  async read(messageIds: number[], signal: AbortSignal): Promise<ParsedObservation[]> {
    this.calls.push({ kind: "read", at: this.clock.time });
    const fallback = messageIds.map((messageId) => ({
      messageId,
      views: this.fallbackViews,
      resultKind: "MESSAGE" as const,
    }));
    return this.step(this.readScript.shift(), signal, fallback, messageIds);
  }

  private async step(
    step: ScriptStep | undefined,
    signal: AbortSignal,
    fallback: ParsedObservation[],
    messageIds: number[] = [],
  ): Promise<ParsedObservation[]> {
    this.clock.advance(this.latencyMs);
    if (step === undefined) return fallback;
    if ("error" in step) throw step.error;
    if ("run" in step) return step.run(signal);
    return messageIds.map((messageId) => ({
      messageId,
      views: step.views,
      resultKind: step.views === null ? ("VIEWS_ABSENT" as const) : ("MESSAGE" as const),
    }));
  }
}
