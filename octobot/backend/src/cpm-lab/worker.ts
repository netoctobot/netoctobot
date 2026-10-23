import type { LabChannelConfig, LabTrialConfig } from "./config.js";
import { LabAbortError } from "./errors.js";
import { executeLabRequest } from "./executor.js";
import type { PollLock } from "./poll-loop.js";
import { actionForError, buildSchedule, LAB_LIMITS, plannedSendTime, requestKey } from "./policy.js";
import type { ParsedObservation, ReaderTransport } from "./readers.js";
import {
  UNRESOLVED_STOP_REASON,
  type AbandonResult,
  type LabStore,
  type ObservationRow,
  type RequestPurpose,
  type RunKind,
} from "./store.js";
import type { LabReader } from "./types.js";

export type LabClock = {
  now(): Date;
  /** Resolves false when stop aborts the wait. */
  sleepUntil(at: Date, stop: AbortSignal): Promise<boolean>;
};

export const systemClock: LabClock = {
  now: () => new Date(),
  sleepUntil(at, stop) {
    const delay = at.getTime() - Date.now();
    if (stop.aborted) return Promise.resolve(false);
    if (delay <= 0) return Promise.resolve(true);
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        stop.removeEventListener("abort", onStop);
        resolve(true);
      }, delay);
      const onStop = () => {
        clearTimeout(timer);
        resolve(false);
      };
      stop.addEventListener("abort", onStop, { once: true });
    });
  },
};

export type WorkerLock = PollLock & { onLost(listener: () => void): void };

export type WorkerSummary = {
  runId: string;
  kind: RunKind;
  stopReason: string;
  abandonedAtStart: AbandonResult;
};

type Slot = {
  transport: ReaderTransport;
  purpose: RequestPurpose;
  key: string;
  slotIndex: number | null;
  retryOfId: string | null;
  dueAt: Date;
  deadline: Date;
  rpcMethod: string;
  send: (signal: AbortSignal) => Promise<ParsedObservation[]>;
};

const PREFLIGHT_WINDOW_MS = 120_000;

/**
 * The caller holds the advisory lock before this runs, so interrupted
 * STARTED rows are abandoned only by the lock holder. Every run gets a new
 * runId. Stored nextAllowedAt and stop marks apply across runs.
 */
export async function runLabWorker(deps: {
  store: LabStore;
  lock: WorkerLock;
  clock: LabClock;
  transports: readonly ReaderTransport[];
  channel: LabChannelConfig;
  trial: LabTrialConfig;
  kind: RunKind;
  stopSignal: AbortSignal;
  settings: Record<string, unknown>;
  libraryTraffic: () => unknown;
  log: (line: string) => void;
  /** Result of abandonInterrupted when the caller already ran it under this lock. */
  abandoned?: AbandonResult;
}): Promise<WorkerSummary> {
  const { store, clock } = deps;
  if (!deps.lock.isHeld()) {
    throw new LabAbortError();
  }
  const lockController = new AbortController();
  deps.lock.onLost(() => lockController.abort(new LabAbortError()));

  const abandonedAtStart = deps.abandoned ?? (await store.abandonInterrupted(clock.now()));
  const channel = await store.ensureChannel(deps.channel.telegramChannelId);
  const post = await store.ensurePost(channel.id, BigInt(deps.channel.postId));
  const run = await store.createRun({
    label: `${deps.kind.toLowerCase()} ${clock.now().toISOString()}`,
    kind: deps.kind,
    settings: {
      ...deps.settings,
      kind: deps.kind,
      rounds: deps.kind === "TRIAL" ? deps.trial.rounds : 0,
      intervalMs: deps.trial.intervalMs,
      telegramChannelId: deps.channel.telegramChannelId.toString(),
      postId: deps.channel.postId,
      readers: deps.transports.map((transport) => transport.reader),
      limits: LAB_LIMITS,
      abandonedAtStart,
      commercialCpmEnabled: false,
    },
    startedAt: clock.now(),
  });
  deps.log(`run ${run.id} started (${deps.kind})`);
  for (const reader of abandonedAtStart.stoppedReaders) {
    await store.addAlert(run.id, "reader_stopped_unresolved", `${reader} ${UNRESOLVED_STOP_REASON}`, clock.now());
    deps.log(`${reader} stopped: a request from an interrupted run has no stored result. Review it, then run clear-stop.`);
  }

  const active = new Map<LabReader, ReaderTransport>();
  let lastRequestedAt: Date | null = null;
  for (const transport of deps.transports) {
    const state = await store.readerState(transport.reader);
    if (state.stoppedAt !== null) {
      await store.addAlert(run.id, "reader_stopped_before_run", `${transport.reader} ${state.stopReason ?? ""}`.trim(), clock.now());
      continue;
    }
    active.set(transport.reader, transport);
    const last = await store.lastRequestedAt(transport.reader);
    if (last && (!lastRequestedAt || last > lastRequestedAt)) {
      lastRequestedAt = last;
    }
  }

  let stopReason: string | null = null;
  const toRows = (parsed: ParsedObservation[]): ObservationRow[] =>
    parsed.map((observation) => ({
      postId: post.id,
      telegramMessageId: BigInt(observation.messageId),
      views: observation.views,
      resultKind: observation.resultKind,
    }));

  const runSlot = async (slot: Slot, isRetry: boolean): Promise<boolean> => {
    const reader = slot.transport.reader;
    for (;;) {
      const state = await store.readerState(reader);
      if (state.stoppedAt !== null) {
        active.delete(reader);
        return false;
      }
      const now = clock.now();
      const plan = plannedSendTime({
        now,
        dueAt: slot.dueAt,
        deadline: slot.deadline,
        nextAllowedAt: state.nextAllowedAt,
        lastRequestedAt,
      });
      if (plan.skip) {
        await store.addAlert(run.id, "slot_skipped", `${slot.key} ${plan.reason}`, now);
        return false;
      }
      if (plan.sendAt.getTime() <= now.getTime()) {
        break;
      }
      if (!(await clock.sleepUntil(plan.sendAt, deps.stopSignal))) {
        stopReason = "signal";
        return false;
      }
    }
    const outcome = await executeLabRequest({
      lock: deps.lock,
      store,
      now: () => clock.now(),
      deadline: slot.deadline,
      lockSignal: lockController.signal,
      spec: {
        runId: run.id,
        reader,
        channelId: channel.id,
        idempotencyKey: slot.key,
        source: "TELEGRAM",
        purpose: slot.purpose,
        rpcMethod: slot.rpcMethod,
        slotIndex: slot.slotIndex,
        retryOfId: slot.retryOfId,
      },
      send: async (signal) => toRows(await slot.send(signal)),
    });
    if ("request" in outcome) {
      lastRequestedAt = outcome.request.requestedAt;
    }
    switch (outcome.kind) {
      case "deadline_passed":
        await store.addAlert(run.id, "slot_skipped", `${slot.key} deadline`, clock.now());
        return false;
      case "lock_lost":
        stopReason = "lock_lost";
        return false;
      case "cap_reached":
        stopReason = "request_cap";
        return false;
      case "existing":
        await store.addAlert(run.id, "existing_key_not_resent", `${slot.key} ${outcome.request.status}`, clock.now());
        return outcome.request.status === "SUCCEEDED";
      case "succeeded":
        return true;
      case "failed": {
        const errorClass = outcome.error.errorClass;
        deps.log(`${slot.key} failed: ${errorClass}`);
        const flood = outcome.flood;
        if (flood !== null) {
          await store.addAlert(
            run.id,
            "flood_wait",
            `${reader} ${outcome.error.floodWaitSeconds}s until ${flood.nextAllowedAt.toISOString()}`,
            clock.now(),
          );
          if (flood.stopReader) {
            await store.addAlert(run.id, "reader_stopped", `${reader} ${flood.reason}`, clock.now());
            active.delete(reader);
          }
          return false;
        }
        const action = actionForError(errorClass, isRetry);
        if (action === "retry_once") {
          return runSlot(
            {
              ...slot,
              purpose: "RETRY",
              key: `${slot.key}:retry1`,
              retryOfId: outcome.request.id,
              dueAt: new Date(clock.now().getTime() + LAB_LIMITS.retryDelayMs),
            },
            true,
          );
        }
        if (action === "stop_reader") {
          await store.stopReader(reader, errorClass, clock.now());
          await store.addAlert(run.id, "reader_stopped", `${reader} ${errorClass}`, clock.now());
          active.delete(reader);
          return false;
        }
        if (action === "stop_run") {
          await store.addAlert(run.id, "run_stopped", `${slot.key} ${errorClass}`, clock.now());
          stopReason = `error:${errorClass}`;
          return false;
        }
        return false;
      }
    }
  };

  const resolved = new Set<LabReader>();
  const ensureResolved = async (
    transport: ReaderTransport,
    window: { dueAt: Date; deadline: Date; round: number | null },
  ): Promise<boolean> => {
    if (resolved.has(transport.reader)) return true;
    const ok = await runSlot(
      {
        transport,
        purpose: "PEER_RESOLUTION",
        key: `${requestKey({ purpose: "peer", reader: transport.reader })}${window.round === null ? "" : `:r${window.round}`}`,
        slotIndex: window.round,
        retryOfId: null,
        dueAt: window.dueAt,
        deadline: window.deadline,
        rpcMethod: transport.resolveMethod,
        send: async (signal) => {
          await transport.resolve(signal);
          return [];
        },
      },
      false,
    );
    if (ok) resolved.add(transport.reader);
    return ok;
  };

  const readSlot = (transport: ReaderTransport, base: Omit<Slot, "transport" | "rpcMethod" | "send" | "retryOfId">): Slot => ({
    ...base,
    transport,
    retryOfId: null,
    rpcMethod: transport.readMethod,
    send: (signal) => transport.read([deps.channel.postId], signal),
  });

  if (deps.kind === "PREFLIGHT") {
    for (const transport of [...active.values()]) {
      if (stopReason) break;
      const now = clock.now();
      const deadline = new Date(now.getTime() + PREFLIGHT_WINDOW_MS);
      if (!(await ensureResolved(transport, { dueAt: now, deadline, round: null }))) {
        if (active.has(transport.reader)) {
          await store.addAlert(run.id, "peer_unresolved", transport.reader, clock.now());
        }
        continue;
      }
      if (stopReason) break;
      await runSlot(
        readSlot(transport, {
          purpose: "PREFLIGHT_READ",
          key: requestKey({ purpose: "preflight", reader: transport.reader }),
          slotIndex: null,
          dueAt: now,
          deadline,
        }),
        false,
      );
    }
  } else {
    const schedule = buildSchedule({
      startAt: clock.now(),
      rounds: deps.trial.rounds,
      intervalMs: deps.trial.intervalMs,
    });
    for (const round of schedule) {
      if (stopReason) break;
      for (const transport of deps.transports) {
        if (stopReason) break;
        if (!active.has(transport.reader)) continue;
        if (!(await ensureResolved(transport, { dueAt: round.dueAt, deadline: round.deadline, round: round.index }))) {
          continue;
        }
        if (stopReason || !active.has(transport.reader)) continue;
        await runSlot(
          readSlot(transport, {
            purpose: "TRIAL_READ",
            key: requestKey({ purpose: "trial", reader: transport.reader, round: round.index }),
            slotIndex: round.index,
            dueAt: round.dueAt,
            deadline: round.deadline,
          }),
          false,
        );
      }
      if (!stopReason && active.size === 0) {
        stopReason = "all_readers_stopped";
      }
    }
  }

  const finalReason = stopReason ?? (active.size === 0 ? "all_readers_stopped" : "completed");
  try {
    await store.finishRun(run.id, {
      stopReason: finalReason,
      libraryTraffic: deps.libraryTraffic(),
      stoppedAt: clock.now(),
    });
  } catch {
    deps.log(`run ${run.id} could not be marked stopped. The next lock holder marks it interrupted.`);
  }
  deps.log(`run ${run.id} stopped: ${finalReason}`);
  return { runId: run.id, kind: deps.kind, stopReason: finalReason, abandonedAtStart };
}
