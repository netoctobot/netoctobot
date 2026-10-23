import { floodDecision, LAB_LIMITS } from "./policy.js";
import { RequestIdentityConflictError } from "./reading-log.js";
import type { LabReader, ObservationSource } from "./types.js";

export type RunKind = "PREFLIGHT" | "TRIAL";
export type RequestPurpose = "TRIAL_READ" | "PREFLIGHT_READ" | "RETRY" | "PEER_RESOLUTION";
export type RequestStatus = "STARTED" | "SUCCEEDED" | "FAILED" | "ABANDONED";
export type ResultKind = "MESSAGE" | "MESSAGE_EMPTY" | "VIEWS_ABSENT";

export const ABANDONED_ERROR_CLASS = "ABANDONED_MAY_HAVE_REACHED_TELEGRAM";

export type RequestSpec = {
  runId: string;
  reader: LabReader;
  channelId: string;
  idempotencyKey: string;
  source: ObservationSource;
  purpose: RequestPurpose;
  rpcMethod: string;
  slotIndex: number | null;
  retryOfId: string | null;
};

export type StoredRequest = RequestSpec & {
  id: string;
  status: RequestStatus;
  errorClass: string | null;
  requestedAt: Date;
  finishedAt: Date | null;
  durationMs: number | null;
  floodWaitSeconds: number | null;
};

export type BeginResult =
  | { kind: "created"; request: StoredRequest }
  | { kind: "existing"; request: StoredRequest };

export type ObservationRow = {
  postId: string;
  telegramMessageId: bigint;
  views: number | null;
  resultKind: ResultKind;
};

export type StoredReading = ObservationRow & {
  requestId: string;
  runId: string;
  channelId: string;
  observedAt: Date;
  source: ObservationSource;
};

export type ReaderState = {
  reader: LabReader;
  nextAllowedAt: Date | null;
  stoppedAt: Date | null;
  stopReason: string | null;
};

export type FloodOutcome = {
  nextAllowedAt: Date;
  priorEventsInWindow: number;
  stopReader: boolean;
  reason: string | null;
  /** True when the request already had its flood event and nothing new was written. */
  replayed: boolean;
};

export type FloodFailureInput = {
  requestId: string;
  reader: LabReader;
  runId: string;
  seconds: number;
  finishedAt: Date;
  durationMs: number;
};

export type AbandonResult = {
  requests: number;
  runs: number;
  /** Readers stopped because a request may have reached Telegram with an unknown result. */
  stoppedReaders: LabReader[];
};

export type LockQuery = (
  sql: string,
  params?: readonly unknown[],
) => Promise<{ rows: Array<Record<string, unknown>> }>;

/**
 * The session row is written on the connection that holds the advisory lock.
 * inLockTransaction begins a transaction on that connection, checks that this
 * same backend still holds the lock, runs the write, and commits. The lock
 * cannot move to another backend until that connection ends, and ending it
 * rolls the transaction back. Checking pg_locks from a different connection
 * does not give that guarantee.
 */
export type SessionWriteGuard = {
  backendPid: number | null;
  isHeld: () => boolean;
  inLockTransaction: (write: (query: LockQuery) => Promise<void>) => Promise<void>;
};

/** Guard for tests that do not open a database connection. */
export function directSessionGuard(isHeld: () => boolean, backendPid: number | null = 1): SessionWriteGuard {
  return {
    backendPid,
    isHeld,
    async inLockTransaction(write) {
      if (!isHeld() || backendPid === null) {
        throw new LabLockLostError();
      }
      await write(async () => ({ rows: [] }));
    },
  };
}

export const UNRESOLVED_STOP_REASON = "unresolved_request_after_interruption";

export type StoredRun = {
  id: string;
  label: string;
  kind: RunKind;
  status: "RUNNING" | "STOPPED";
  settings: unknown;
  libraryTraffic: unknown;
  stopReason: string | null;
  startedAt: Date;
  stoppedAt: Date | null;
};

export type StoredAlert = { runId: string; kind: string; detail: string; createdAt: Date };
export type StoredManualEvent = {
  runId: string;
  kind: string;
  occurredAt: Date;
  note: string | null;
};
export type StoredFloodEvent = {
  reader: LabReader;
  runId: string | null;
  requestId: string | null;
  seconds: number;
  occurredAt: Date;
  nextAllowedAt: Date;
};

export type RunReportData = {
  run: StoredRun;
  requests: StoredRequest[];
  readings: StoredReading[];
  alerts: StoredAlert[];
  manualEvents: StoredManualEvent[];
  floodEvents: StoredFloodEvent[];
};

export class SessionExistsError extends Error {
  constructor() {
    super("A lab session for this reader already exists. Pass --replace to overwrite it.");
    this.name = "SessionExistsError";
  }
}

export class NoTrialRunError extends Error {
  constructor() {
    super("No lab trial run exists for this event. Start the trial first, or pass --run.");
    this.name = "NoTrialRunError";
  }
}

export class LabLockLostError extends Error {
  constructor() {
    super("The CPM lab advisory lock was lost. Nothing more was sent or stored.");
    this.name = "LabLockLostError";
  }
}

export class RequestStateError extends Error {
  constructor() {
    super("The lab request is no longer STARTED, so its result was not stored");
    this.name = "RequestStateError";
  }
}

export interface LabStore {
  ensureChannel(telegramChannelId: bigint): Promise<{ id: string }>;
  ensurePost(channelId: string, telegramMessageId: bigint): Promise<{ id: string }>;
  createRun(input: { label: string; kind: RunKind; settings: unknown; startedAt: Date }): Promise<{ id: string }>;
  finishRun(runId: string, input: { stopReason: string; libraryTraffic: unknown; stoppedAt: Date }): Promise<void>;
  /**
   * Call only while holding the advisory lock. STARTED rows become ABANDONED
   * and their readers are stopped in the same transaction, because a lost
   * FLOOD_WAIT or session error cannot be ruled out. clear-stop is a manual step.
   */
  abandonInterrupted(now: Date): Promise<AbandonResult>;
  beginRequest(spec: RequestSpec, now: Date): Promise<BeginResult>;
  completeRequest(input: {
    requestId: string;
    observations: ObservationRow[];
    observedAt: Date;
    durationMs: number;
  }): Promise<void>;
  failRequest(input: {
    requestId: string;
    errorClass: string;
    floodWaitSeconds: number | null;
    finishedAt: Date;
    durationMs: number;
  }): Promise<void>;
  countRunRequests(runId: string): Promise<number>;
  lastRequestedAt(reader: LabReader): Promise<Date | null>;
  readerState(reader: LabReader): Promise<ReaderState>;
  readerStates(): Promise<ReaderState[]>;
  /**
   * One transaction: the request becomes FAILED with FLOOD_WAIT, the flood
   * event is inserted, and nextAllowedAt and any stop are written. Calling it
   * again for the same request returns the stored outcome without a new event.
   */
  failRequestWithFlood(input: FloodFailureInput): Promise<FloodOutcome>;
  stopReader(reader: LabReader, reason: string, now: Date): Promise<void>;
  clearReaderStop(reader: LabReader): Promise<ReaderState>;
  addAlert(runId: string, kind: string, detail: string, now: Date): Promise<void>;
  loadSession(reader: LabReader): Promise<{ ciphertext: string; keyVersion: number } | null>;
  saveSession(reader: LabReader, ciphertext: string, replace: boolean, guard: SessionWriteGuard): Promise<void>;
  addManualEvent(input: {
    runId: string | null;
    kind: string;
    occurredAt: Date;
    note: string | null;
  }): Promise<{ runId: string }>;
  loadRunReport(runId: string | null, kind: RunKind): Promise<RunReportData | null>;
  listRuns(limit: number): Promise<StoredRun[]>;
  countStarted(): Promise<number>;
  close(): Promise<void>;
}

export function assertSameRequestIdentity(existing: RequestSpec, incoming: RequestSpec): void {
  if (existing.channelId !== incoming.channelId) {
    throw new RequestIdentityConflictError("channelId");
  }
  if (existing.reader !== incoming.reader) {
    throw new RequestIdentityConflictError("reader");
  }
  if (existing.source !== incoming.source) {
    throw new RequestIdentityConflictError("source");
  }
}

/** Same rules as the Prisma store. Used by unit tests without a database. */
export class MemoryLabStore implements LabStore {
  private sequence = 0;
  readonly channels: Array<{ id: string; telegramChannelId: bigint }> = [];
  readonly posts: Array<{ id: string; channelId: string; telegramMessageId: bigint }> = [];
  readonly runs: StoredRun[] = [];
  readonly requests: StoredRequest[] = [];
  readonly readings: StoredReading[] = [];
  readonly alerts: StoredAlert[] = [];
  readonly manualEvents: StoredManualEvent[] = [];
  readonly floodEvents: StoredFloodEvent[] = [];
  readonly states = new Map<LabReader, ReaderState>();
  readonly sessions = new Map<LabReader, { ciphertext: string; keyVersion: number }>();
  failNextComplete = false;
  closed = false;

  private nextId(prefix: string): string {
    this.sequence += 1;
    return `${prefix}-${this.sequence}`;
  }

  async ensureChannel(telegramChannelId: bigint) {
    const found = this.channels.find((channel) => channel.telegramChannelId === telegramChannelId);
    if (found) return { id: found.id };
    const created = { id: this.nextId("channel"), telegramChannelId };
    this.channels.push(created);
    return { id: created.id };
  }

  async ensurePost(channelId: string, telegramMessageId: bigint) {
    const found = this.posts.find(
      (post) => post.channelId === channelId && post.telegramMessageId === telegramMessageId,
    );
    if (found) return { id: found.id };
    const created = { id: this.nextId("post"), channelId, telegramMessageId };
    this.posts.push(created);
    return { id: created.id };
  }

  async createRun(input: { label: string; kind: RunKind; settings: unknown; startedAt: Date }) {
    const run: StoredRun = {
      id: this.nextId("run"),
      label: input.label,
      kind: input.kind,
      status: "RUNNING",
      settings: input.settings,
      libraryTraffic: null,
      stopReason: null,
      startedAt: input.startedAt,
      stoppedAt: null,
    };
    this.runs.push(run);
    return { id: run.id };
  }

  async finishRun(runId: string, input: { stopReason: string; libraryTraffic: unknown; stoppedAt: Date }) {
    const run = this.runs.find((candidate) => candidate.id === runId);
    if (!run) throw new Error("run not found");
    run.status = "STOPPED";
    run.stopReason = input.stopReason;
    run.libraryTraffic = input.libraryTraffic;
    run.stoppedAt = input.stoppedAt;
  }

  async abandonInterrupted(now: Date): Promise<AbandonResult> {
    let requests = 0;
    const stoppedReaders: LabReader[] = [];
    for (const request of this.requests) {
      if (request.status === "STARTED") {
        request.status = "ABANDONED";
        request.errorClass = ABANDONED_ERROR_CLASS;
        request.finishedAt = now;
        requests += 1;
        const state = this.states.get(request.reader) ?? emptyState(request.reader);
        if (state.stoppedAt === null) {
          this.states.set(request.reader, { ...state, stoppedAt: now, stopReason: UNRESOLVED_STOP_REASON });
          stoppedReaders.push(request.reader);
        }
      }
    }
    let runs = 0;
    for (const run of this.runs) {
      if (run.status === "RUNNING") {
        run.status = "STOPPED";
        run.stopReason = "interrupted";
        run.stoppedAt = now;
        runs += 1;
      }
    }
    return { requests, runs, stoppedReaders };
  }

  async beginRequest(spec: RequestSpec, now: Date): Promise<BeginResult> {
    const existing = this.requests.find(
      (request) => request.runId === spec.runId && request.idempotencyKey === spec.idempotencyKey,
    );
    if (existing) {
      assertSameRequestIdentity(existing, spec);
      return { kind: "existing", request: { ...existing } };
    }
    const request: StoredRequest = {
      ...spec,
      id: this.nextId("rpc"),
      status: "STARTED",
      errorClass: null,
      requestedAt: now,
      finishedAt: null,
      durationMs: null,
      floodWaitSeconds: null,
    };
    this.requests.push(request);
    return { kind: "created", request: { ...request } };
  }

  async completeRequest(input: {
    requestId: string;
    observations: ObservationRow[];
    observedAt: Date;
    durationMs: number;
  }) {
    if (this.failNextComplete) {
      this.failNextComplete = false;
      throw new Error("simulated persistence failure");
    }
    const request = this.requests.find((candidate) => candidate.id === input.requestId);
    if (!request || request.status !== "STARTED") throw new RequestStateError();
    const seen = new Set(
      this.readings.filter((reading) => reading.requestId === request.id).map((reading) => reading.telegramMessageId),
    );
    for (const observation of input.observations) {
      if (seen.has(observation.telegramMessageId)) throw new Error("duplicate reading");
      seen.add(observation.telegramMessageId);
    }
    for (const observation of input.observations) {
      this.readings.push({
        ...observation,
        requestId: request.id,
        runId: request.runId,
        channelId: request.channelId,
        observedAt: input.observedAt,
        source: request.source,
      });
    }
    request.status = "SUCCEEDED";
    request.finishedAt = input.observedAt;
    request.durationMs = input.durationMs;
  }

  async failRequest(input: {
    requestId: string;
    errorClass: string;
    floodWaitSeconds: number | null;
    finishedAt: Date;
    durationMs: number;
  }) {
    const request = this.requests.find((candidate) => candidate.id === input.requestId);
    if (!request || request.status !== "STARTED") throw new RequestStateError();
    request.status = "FAILED";
    request.errorClass = input.errorClass;
    request.floodWaitSeconds = input.floodWaitSeconds;
    request.finishedAt = input.finishedAt;
    request.durationMs = input.durationMs;
  }

  async countRunRequests(runId: string) {
    return this.requests.filter((request) => request.runId === runId).length;
  }

  async lastRequestedAt(reader: LabReader) {
    const times = this.requests
      .filter((request) => request.reader === reader)
      .map((request) => request.requestedAt.getTime());
    return times.length === 0 ? null : new Date(Math.max(...times));
  }

  async readerState(reader: LabReader): Promise<ReaderState> {
    return { ...(this.states.get(reader) ?? emptyState(reader)) };
  }

  async readerStates() {
    return [...this.states.values()].map((state) => ({ ...state }));
  }

  failFloodWritesBeforeCommit = false;

  async failRequestWithFlood(input: FloodFailureInput): Promise<FloodOutcome> {
    const request = this.requests.find((candidate) => candidate.id === input.requestId);
    if (!request) throw new RequestStateError();
    const existing = this.floodEvents.find((event) => event.requestId === input.requestId);
    if (existing) {
      return this.storedFloodOutcome(input.reader, existing);
    }
    if (request.status !== "STARTED") throw new RequestStateError();
    const prior = this.priorFloodEvents(input.reader, input.finishedAt);
    const decision = floodDecision({ priorEventsInWindow: prior, seconds: input.seconds });
    const requested = new Date(input.finishedAt.getTime() + input.seconds * 1000);
    const state = this.states.get(input.reader) ?? emptyState(input.reader);
    const nextAllowedAt = laterOf(state.nextAllowedAt, requested);
    if (this.failFloodWritesBeforeCommit) {
      this.failFloodWritesBeforeCommit = false;
      throw new Error("simulated failure inside the flood transaction");
    }
    request.status = "FAILED";
    request.errorClass = "FLOOD_WAIT";
    request.floodWaitSeconds = input.seconds;
    request.finishedAt = input.finishedAt;
    request.durationMs = input.durationMs;
    this.floodEvents.push({
      reader: input.reader,
      runId: input.runId,
      requestId: input.requestId,
      seconds: input.seconds,
      occurredAt: input.finishedAt,
      nextAllowedAt: requested,
    });
    this.states.set(input.reader, {
      ...state,
      nextAllowedAt,
      ...(decision.stopReader && state.stoppedAt === null
        ? { stoppedAt: input.finishedAt, stopReason: decision.reason }
        : {}),
    });
    return { nextAllowedAt, priorEventsInWindow: prior, ...decision, replayed: false };
  }

  private priorFloodEvents(reader: LabReader, at: Date): number {
    const since = at.getTime() - LAB_LIMITS.floodWindowMs;
    return this.floodEvents.filter(
      (event) => event.reader === reader && event.occurredAt.getTime() > since && event.occurredAt.getTime() <= at.getTime(),
    ).length;
  }

  private storedFloodOutcome(reader: LabReader, event: StoredFloodEvent): FloodOutcome {
    const prior = this.floodEvents.filter(
      (candidate) =>
        candidate !== event &&
        candidate.reader === reader &&
        candidate.occurredAt.getTime() > event.occurredAt.getTime() - LAB_LIMITS.floodWindowMs &&
        candidate.occurredAt.getTime() <= event.occurredAt.getTime(),
    ).length;
    const decision = floodDecision({ priorEventsInWindow: prior, seconds: event.seconds });
    const state = this.states.get(reader) ?? emptyState(reader);
    return {
      nextAllowedAt: laterOf(state.nextAllowedAt, event.nextAllowedAt),
      priorEventsInWindow: prior,
      ...decision,
      replayed: true,
    };
  }

  async stopReader(reader: LabReader, reason: string, now: Date) {
    const state = this.states.get(reader) ?? emptyState(reader);
    if (state.stoppedAt === null) {
      this.states.set(reader, { ...state, stoppedAt: now, stopReason: reason });
    }
  }

  async clearReaderStop(reader: LabReader) {
    const state = this.states.get(reader) ?? emptyState(reader);
    const cleared = { ...state, stoppedAt: null, stopReason: null };
    this.states.set(reader, cleared);
    return { ...cleared };
  }

  async addAlert(runId: string, kind: string, detail: string, now: Date) {
    this.alerts.push({ runId, kind, detail, createdAt: now });
  }

  async loadSession(reader: LabReader) {
    return this.sessions.get(reader) ?? null;
  }

  async saveSession(reader: LabReader, ciphertext: string, replace: boolean, guard: SessionWriteGuard) {
    if (!guard.isHeld() || guard.backendPid === null) throw new LabLockLostError();
    let stored: { ciphertext: string; keyVersion: number } | null = null;
    await guard.inLockTransaction(async () => {
      if (!guard.isHeld()) throw new LabLockLostError();
      if (this.sessions.has(reader) && !replace) throw new SessionExistsError();
      stored = { ciphertext, keyVersion: 1 };
    });
    if (stored !== null) {
      this.sessions.set(reader, stored);
    }
  }

  async addManualEvent(input: { runId: string | null; kind: string; occurredAt: Date; note: string | null }) {
    const runId = input.runId ?? latestRun(this.runs, "TRIAL")?.id;
    if (!runId || !this.runs.some((run) => run.id === runId)) {
      throw new NoTrialRunError();
    }
    this.manualEvents.push({ runId, kind: input.kind, occurredAt: input.occurredAt, note: input.note });
    return { runId };
  }

  async loadRunReport(runId: string | null, kind: RunKind): Promise<RunReportData | null> {
    const run = runId ? this.runs.find((candidate) => candidate.id === runId) : latestRun(this.runs, kind);
    if (!run) return null;
    return {
      run: { ...run },
      requests: this.requests.filter((request) => request.runId === run.id).map((request) => ({ ...request })),
      readings: this.readings.filter((reading) => reading.runId === run.id).map((reading) => ({ ...reading })),
      alerts: this.alerts.filter((alert) => alert.runId === run.id),
      manualEvents: this.manualEvents.filter((event) => event.runId === run.id),
      floodEvents: this.floodEvents.filter((event) => event.runId === run.id),
    };
  }

  async listRuns(limit: number) {
    return [...this.runs].sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime()).slice(0, limit);
  }

  async countStarted() {
    return this.requests.filter((request) => request.status === "STARTED").length;
  }

  async close() {
    this.closed = true;
  }
}

function emptyState(reader: LabReader): ReaderState {
  return { reader, nextAllowedAt: null, stoppedAt: null, stopReason: null };
}

function laterOf(left: Date | null, right: Date): Date {
  return left !== null && left.getTime() > right.getTime() ? left : right;
}

function latestRun(runs: readonly StoredRun[], kind: RunKind): StoredRun | undefined {
  return [...runs]
    .filter((run) => run.kind === kind)
    .sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime())[0];
}
