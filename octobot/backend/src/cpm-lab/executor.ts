import { classifyThrown, type ClassifiedLabError } from "./errors.js";
import type { PollLock } from "./poll-loop.js";
import { LAB_LIMITS } from "./policy.js";
import type { FloodOutcome, LabStore, ObservationRow, RequestSpec, StoredRequest } from "./store.js";

export class LabPersistenceError extends Error {
  constructor(readonly stage: "begin" | "complete" | "fail") {
    super(`CPM lab could not store the request (${stage}). The worker stops without retrying the write.`);
    this.name = "LabPersistenceError";
  }
}

export type ExecuteOutcome =
  | { kind: "succeeded"; request: StoredRequest; observations: ObservationRow[] }
  | { kind: "failed"; request: StoredRequest; error: ClassifiedLabError; flood: FloodOutcome | null }
  | { kind: "existing"; request: StoredRequest }
  | { kind: "deadline_passed" }
  | { kind: "lock_lost" }
  | { kind: "cap_reached" };

/**
 * One lab request. The lock is probed first. The STARTED row is committed
 * before the RPC, and only while the slot deadline has not passed. A key that
 * already exists in any status is not sent again. If the lock is lost while
 * the RPC is in flight, the call is aborted, nothing is written, and the row
 * stays STARTED for the next lock holder to abandon. A FLOOD_WAIT result is
 * stored with its flood event and reader state in one transaction. A failed
 * write raises LabPersistenceError so the worker stops.
 */
export async function executeLabRequest(input: {
  lock: PollLock;
  store: LabStore;
  spec: RequestSpec;
  now: () => Date;
  deadline: Date | null;
  lockSignal: AbortSignal;
  send: (signal: AbortSignal) => Promise<ObservationRow[]>;
}): Promise<ExecuteOutcome> {
  if (!(await probe(input.lock)) || input.lockSignal.aborted) {
    return { kind: "lock_lost" };
  }
  let count: number;
  try {
    count = await input.store.countRunRequests(input.spec.runId);
  } catch {
    throw new LabPersistenceError("begin");
  }
  if (count >= LAB_LIMITS.maxRequestsPerRun) {
    return { kind: "cap_reached" };
  }

  const startedAt = input.now();
  if (input.deadline !== null && startedAt.getTime() >= input.deadline.getTime()) {
    return { kind: "deadline_passed" };
  }
  let begun;
  try {
    begun = await input.store.beginRequest(input.spec, startedAt);
  } catch (error) {
    if (error instanceof Error && error.name === "RequestIdentityConflictError") {
      throw error;
    }
    throw new LabPersistenceError("begin");
  }
  if (begun.kind === "existing") {
    return { kind: "existing", request: begun.request };
  }

  let observations: ObservationRow[] | null = null;
  let thrown: unknown = null;
  try {
    observations = await input.send(input.lockSignal);
  } catch (error) {
    thrown = error;
  }

  if (input.lockSignal.aborted || !input.lock.isHeld()) {
    return { kind: "lock_lost" };
  }
  const finishedAt = input.now();
  const durationMs = Math.max(0, finishedAt.getTime() - startedAt.getTime());

  if (observations !== null) {
    try {
      await input.store.completeRequest({
        requestId: begun.request.id,
        observations,
        observedAt: finishedAt,
        durationMs,
      });
    } catch {
      throw new LabPersistenceError("complete");
    }
    return {
      kind: "succeeded",
      request: { ...begun.request, status: "SUCCEEDED", finishedAt, durationMs },
      observations,
    };
  }

  const classified = classifyThrown(thrown);
  let flood: FloodOutcome | null = null;
  try {
    if (classified.errorClass === "FLOOD_WAIT" && classified.floodWaitSeconds !== null) {
      flood = await input.store.failRequestWithFlood({
        requestId: begun.request.id,
        reader: begun.request.reader,
        runId: begun.request.runId,
        seconds: classified.floodWaitSeconds,
        finishedAt,
        durationMs,
      });
    } else {
      await input.store.failRequest({
        requestId: begun.request.id,
        errorClass: classified.errorClass,
        floodWaitSeconds: classified.floodWaitSeconds,
        finishedAt,
        durationMs,
      });
    }
  } catch {
    throw new LabPersistenceError("fail");
  }
  return {
    kind: "failed",
    request: {
      ...begun.request,
      status: "FAILED",
      errorClass: classified.errorClass,
      floodWaitSeconds: classified.floodWaitSeconds,
      finishedAt,
      durationMs,
    },
    error: classified,
    flood,
  };
}

async function probe(lock: PollLock): Promise<boolean> {
  if (!lock.isHeld()) {
    return false;
  }
  try {
    return await lock.probe();
  } catch {
    return false;
  }
}
