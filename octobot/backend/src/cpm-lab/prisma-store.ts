import { randomBytes } from "node:crypto";
import { floodDecision, LAB_LIMITS } from "./policy.js";
import {
  ABANDONED_ERROR_CLASS,
  assertSameRequestIdentity,
  LabLockLostError,
  NoTrialRunError,
  RequestStateError,
  SessionExistsError,
  UNRESOLVED_STOP_REASON,
  type AbandonResult,
  type BeginResult,
  type FloodFailureInput,
  type FloodOutcome,
  type LabStore,
  type SessionWriteGuard,
  type ObservationRow,
  type ReaderState,
  type RequestSpec,
  type RunKind,
  type RunReportData,
  type StoredRequest,
  type StoredRun,
} from "./store.js";
import type { LabReader } from "./types.js";

/**
 * The lab client is generated into backend/generated/cpm-lab-client by
 * lab:generate or Dockerfile.lab. It is loaded at runtime so the application
 * build and fixture mode do not depend on it. These narrow types cover only
 * the calls made here.
 */
type Args = Record<string, unknown>;
type Delegate = {
  create(args: Args): Promise<any>;
  createMany(args: Args): Promise<{ count: number }>;
  findUnique(args: Args): Promise<any>;
  findFirst(args: Args): Promise<any>;
  findMany(args: Args): Promise<any[]>;
  updateMany(args: Args): Promise<{ count: number }>;
  upsert(args: Args): Promise<any>;
  count(args: Args): Promise<number>;
  aggregate(args: Args): Promise<any>;
};
type LabPrismaTx = {
  cpmLabRun: Delegate;
  cpmLabChannel: Delegate;
  cpmLabPost: Delegate;
  cpmLabRpcRequest: Delegate;
  cpmLabReading: Delegate;
  cpmLabAlert: Delegate;
  cpmLabSession: Delegate;
  cpmLabReaderState: Delegate;
  cpmLabFloodEvent: Delegate;
  cpmLabManualEvent: Delegate;
  $queryRawUnsafe<T>(sql: string, ...values: unknown[]): Promise<T>;
};
type LabPrismaClient = LabPrismaTx & {
  $transaction<T>(fn: (tx: LabPrismaTx) => Promise<T>): Promise<T>;
  $disconnect(): Promise<void>;
};

export class LabClientMissingError extends Error {
  constructor() {
    super("The lab Prisma client is not generated. Run lab:generate or build Dockerfile.lab.");
    this.name = "LabClientMissingError";
  }
}

export async function openPrismaLabStore(databaseUrl: string): Promise<PrismaLabStore> {
  const specifier = new URL("../../generated/cpm-lab-client/index.js", import.meta.url).href;
  let module: Record<string, any>;
  try {
    module = (await import(specifier)) as Record<string, any>;
  } catch {
    throw new LabClientMissingError();
  }
  const PrismaClient = module.PrismaClient ?? module.default?.PrismaClient;
  if (typeof PrismaClient !== "function") {
    throw new LabClientMissingError();
  }
  const client = new PrismaClient({
    datasources: { db: { url: databaseUrl } },
    log: [],
  }) as LabPrismaClient;
  return new PrismaLabStore(client, schemaFromDatabaseUrl(databaseUrl));
}

const SCHEMA_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

function schemaFromDatabaseUrl(databaseUrl: string): string | null {
  let schema: string | null;
  try {
    schema = new URL(databaseUrl).searchParams.get("schema");
  } catch {
    throw new Error("The lab database URL could not be parsed. The URL was not shown.");
  }
  if (schema === null || schema === "" || schema === "public") {
    return null;
  }
  if (!SCHEMA_NAME.test(schema)) {
    throw new Error("The lab database schema name is not one identifier. The URL was not shown.");
  }
  return schema;
}

function sessionRowId(): string {
  return `lab_${randomBytes(16).toString("hex")}`;
}

export class PrismaLabStore implements LabStore {
  constructor(
    private readonly prisma: LabPrismaClient,
    private readonly schema: string | null,
  ) {}

  async ensureChannel(telegramChannelId: bigint) {
    const row = await this.prisma.cpmLabChannel.upsert({
      where: { telegramChannelId },
      create: { telegramChannelId, isPrivate: true },
      update: {},
    });
    return { id: row.id as string };
  }

  async ensurePost(channelId: string, telegramMessageId: bigint) {
    const row = await this.prisma.cpmLabPost.upsert({
      where: { channelId_telegramMessageId: { channelId, telegramMessageId } },
      create: { channelId, telegramMessageId },
      update: {},
    });
    return { id: row.id as string };
  }

  async createRun(input: { label: string; kind: RunKind; settings: unknown; startedAt: Date }) {
    const row = await this.prisma.cpmLabRun.create({
      data: {
        label: input.label,
        kind: input.kind,
        settings: input.settings,
        startedAt: input.startedAt,
      },
    });
    return { id: row.id as string };
  }

  async finishRun(runId: string, input: { stopReason: string; libraryTraffic: unknown; stoppedAt: Date }) {
    await this.prisma.cpmLabRun.updateMany({
      where: { id: runId },
      data: {
        status: "STOPPED",
        stopReason: input.stopReason,
        libraryTraffic: input.libraryTraffic,
        stoppedAt: input.stoppedAt,
      },
    });
  }

  async abandonInterrupted(now: Date): Promise<AbandonResult> {
    return this.prisma.$transaction(async (tx) => {
      const started = await tx.cpmLabRpcRequest.findMany({
        where: { status: "STARTED" },
        select: { id: true, reader: true },
      });
      const requests = await tx.cpmLabRpcRequest.updateMany({
        where: { id: { in: started.map((row) => row.id) }, status: "STARTED" },
        data: { status: "ABANDONED", errorClass: ABANDONED_ERROR_CLASS, finishedAt: now },
      });
      if (requests.count !== started.length) {
        throw new RequestStateError();
      }
      const stoppedReaders: LabReader[] = [];
      for (const reader of new Set(started.map((row) => row.reader as LabReader))) {
        const current = toState(reader, await tx.cpmLabReaderState.findUnique({ where: { reader } }));
        if (current.stoppedAt !== null) {
          continue;
        }
        await tx.cpmLabReaderState.upsert({
          where: { reader },
          create: { reader, stoppedAt: now, stopReason: UNRESOLVED_STOP_REASON },
          update: { stoppedAt: now, stopReason: UNRESOLVED_STOP_REASON },
        });
        stoppedReaders.push(reader);
      }
      const runs = await tx.cpmLabRun.updateMany({
        where: { status: "RUNNING" },
        data: { status: "STOPPED", stopReason: "interrupted", stoppedAt: now },
      });
      return { requests: requests.count, runs: runs.count, stoppedReaders };
    });
  }

  async beginRequest(spec: RequestSpec, now: Date): Promise<BeginResult> {
    try {
      const row = await this.prisma.cpmLabRpcRequest.create({
        data: { ...spec, status: "STARTED", requestedAt: now },
      });
      return { kind: "created", request: toRequest(row) };
    } catch (error) {
      if (!isUniqueViolation(error)) {
        throw error;
      }
      const existing = await this.prisma.cpmLabRpcRequest.findUnique({
        where: { runId_idempotencyKey: { runId: spec.runId, idempotencyKey: spec.idempotencyKey } },
      });
      if (!existing) {
        throw error;
      }
      const stored = toRequest(existing);
      assertSameRequestIdentity(stored, spec);
      return { kind: "existing", request: stored };
    }
  }

  async completeRequest(input: {
    requestId: string;
    observations: ObservationRow[];
    observedAt: Date;
    durationMs: number;
  }) {
    await this.prisma.$transaction(async (tx) => {
      const request = await tx.cpmLabRpcRequest.findUnique({ where: { id: input.requestId } });
      const updated = await tx.cpmLabRpcRequest.updateMany({
        where: { id: input.requestId, status: "STARTED" },
        data: { status: "SUCCEEDED", finishedAt: input.observedAt, durationMs: input.durationMs },
      });
      if (!request || updated.count !== 1) {
        throw new RequestStateError();
      }
      if (input.observations.length > 0) {
        await tx.cpmLabReading.createMany({
          data: input.observations.map((observation) => ({
            requestId: request.id,
            runId: request.runId,
            channelId: request.channelId,
            postId: observation.postId,
            telegramMessageId: observation.telegramMessageId,
            views: observation.views,
            resultKind: observation.resultKind,
            observedAt: input.observedAt,
            source: request.source,
          })),
        });
      }
    });
  }

  async failRequest(input: {
    requestId: string;
    errorClass: string;
    floodWaitSeconds: number | null;
    finishedAt: Date;
    durationMs: number;
  }) {
    const updated = await this.prisma.cpmLabRpcRequest.updateMany({
      where: { id: input.requestId, status: "STARTED" },
      data: {
        status: "FAILED",
        errorClass: input.errorClass,
        floodWaitSeconds: input.floodWaitSeconds,
        finishedAt: input.finishedAt,
        durationMs: input.durationMs,
      },
    });
    if (updated.count !== 1) {
      throw new RequestStateError();
    }
  }

  async countRunRequests(runId: string) {
    return this.prisma.cpmLabRpcRequest.count({ where: { runId } });
  }

  async lastRequestedAt(reader: LabReader) {
    const result = await this.prisma.cpmLabRpcRequest.aggregate({
      where: { reader },
      _max: { requestedAt: true },
    });
    return (result?._max?.requestedAt as Date | null | undefined) ?? null;
  }

  async readerState(reader: LabReader): Promise<ReaderState> {
    const row = await this.prisma.cpmLabReaderState.findUnique({ where: { reader } });
    return toState(reader, row);
  }

  async failRequestWithFlood(input: FloodFailureInput): Promise<FloodOutcome> {
    try {
      return await this.floodTransaction(input);
    } catch (error) {
      if (!isUniqueViolation(error)) {
        throw error;
      }
      return this.floodTransaction(input);
    }
  }

  /**
   * The request row is locked first, so a concurrent call for the same
   * request waits and then returns the stored outcome. The unique requestId
   * on flood events is the second line of defense.
   */
  private async floodTransaction(input: FloodFailureInput): Promise<FloodOutcome> {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRawUnsafe(LOCK_REQUEST_ROW_SQL, input.requestId);
      const request = await tx.cpmLabRpcRequest.findUnique({ where: { id: input.requestId } });
      if (!request) {
        throw new RequestStateError();
      }
      const existing = await tx.cpmLabFloodEvent.findUnique({ where: { requestId: input.requestId } });
      if (existing) {
        const prior = await countPriorFloodEvents(tx, input.reader, existing.occurredAt, existing.id);
        const decision = floodDecision({ priorEventsInWindow: prior, seconds: existing.seconds });
        const current = toState(input.reader, await tx.cpmLabReaderState.findUnique({ where: { reader: input.reader } }));
        return {
          nextAllowedAt: laterOf(current.nextAllowedAt, existing.nextAllowedAt),
          priorEventsInWindow: prior,
          ...decision,
          replayed: true,
        };
      }
      if (request.status !== "STARTED") {
        throw new RequestStateError();
      }
      const prior = await countPriorFloodEvents(tx, input.reader, input.finishedAt, null);
      const decision = floodDecision({ priorEventsInWindow: prior, seconds: input.seconds });
      const requested = new Date(input.finishedAt.getTime() + input.seconds * 1000);
      const updated = await tx.cpmLabRpcRequest.updateMany({
        where: { id: input.requestId, status: "STARTED" },
        data: {
          status: "FAILED",
          errorClass: "FLOOD_WAIT",
          floodWaitSeconds: input.seconds,
          finishedAt: input.finishedAt,
          durationMs: input.durationMs,
        },
      });
      if (updated.count !== 1) {
        throw new RequestStateError();
      }
      await tx.cpmLabFloodEvent.create({
        data: {
          reader: input.reader,
          runId: input.runId,
          requestId: input.requestId,
          seconds: input.seconds,
          occurredAt: input.finishedAt,
          nextAllowedAt: requested,
        },
      });
      const current = toState(input.reader, await tx.cpmLabReaderState.findUnique({ where: { reader: input.reader } }));
      const nextAllowedAt = laterOf(current.nextAllowedAt, requested);
      const stopFields =
        decision.stopReader && current.stoppedAt === null
          ? { stoppedAt: input.finishedAt, stopReason: decision.reason }
          : {};
      await tx.cpmLabReaderState.upsert({
        where: { reader: input.reader },
        create: { reader: input.reader, nextAllowedAt, ...stopFields },
        update: { nextAllowedAt, ...stopFields },
      });
      return { nextAllowedAt, priorEventsInWindow: prior, ...decision, replayed: false };
    });
  }

  async stopReader(reader: LabReader, reason: string, now: Date) {
    await this.prisma.$transaction(async (tx) => {
      const current = toState(reader, await tx.cpmLabReaderState.findUnique({ where: { reader } }));
      if (current.stoppedAt !== null) {
        return;
      }
      await tx.cpmLabReaderState.upsert({
        where: { reader },
        create: { reader, stoppedAt: now, stopReason: reason },
        update: { stoppedAt: now, stopReason: reason },
      });
    });
  }

  async clearReaderStop(reader: LabReader) {
    const row = await this.prisma.cpmLabReaderState.upsert({
      where: { reader },
      create: { reader },
      update: { stoppedAt: null, stopReason: null },
    });
    return toState(reader, row);
  }

  async addAlert(runId: string, kind: string, detail: string, now: Date) {
    await this.prisma.cpmLabAlert.create({ data: { runId, kind, detail, createdAt: now } });
  }

  async loadSession(reader: LabReader) {
    const row = await this.prisma.cpmLabSession.findUnique({ where: { reader } });
    return row ? { ciphertext: row.ciphertext as string, keyVersion: row.keyVersion as number } : null;
  }

  /**
   * The INSERT or UPDATE runs on the lock connection, inside the transaction
   * started by the guard. Prisma's pool is not used. If that connection dies
   * after the lock check and before COMMIT, PostgreSQL rolls the row back.
   */
  async saveSession(reader: LabReader, ciphertext: string, replace: boolean, guard: SessionWriteGuard) {
    if (!guard.isHeld() || guard.backendPid === null) {
      throw new LabLockLostError();
    }
    const schema = this.schema;
    try {
      await guard.inLockTransaction(async (query) => {
        if (schema !== null) {
          await query(`SELECT set_config('search_path', $1, true)`, [schema]);
        }
        await query(
          replace
            ? `INSERT INTO cpm_lab_sessions (id, reader, ciphertext)
               VALUES ($1, $2::"CpmLabReaderKind", $3)
               ON CONFLICT (reader) DO UPDATE
                 SET ciphertext = EXCLUDED.ciphertext, "keyVersion" = 1`
            : `INSERT INTO cpm_lab_sessions (id, reader, ciphertext)
               VALUES ($1, $2::"CpmLabReaderKind", $3)`,
          [sessionRowId(), reader, ciphertext],
        );
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new SessionExistsError();
      }
      throw error;
    }
  }

  async addManualEvent(input: { runId: string | null; kind: string; occurredAt: Date; note: string | null }) {
    const run = input.runId
      ? await this.prisma.cpmLabRun.findUnique({ where: { id: input.runId } })
      : await this.prisma.cpmLabRun.findFirst({ where: { kind: "TRIAL" }, orderBy: { startedAt: "desc" } });
    if (!run) {
      throw new NoTrialRunError();
    }
    await this.prisma.cpmLabManualEvent.create({
      data: { runId: run.id, kind: input.kind, occurredAt: input.occurredAt, note: input.note },
    });
    return { runId: run.id as string };
  }

  async loadRunReport(runId: string | null, kind: RunKind): Promise<RunReportData | null> {
    const run = runId
      ? await this.prisma.cpmLabRun.findUnique({ where: { id: runId } })
      : await this.prisma.cpmLabRun.findFirst({ where: { kind }, orderBy: { startedAt: "desc" } });
    if (!run) {
      return null;
    }
    const where = { where: { runId: run.id } };
    const [requests, readings, alerts, manualEvents, floodEvents] = await Promise.all([
      this.prisma.cpmLabRpcRequest.findMany({ ...where, orderBy: { requestedAt: "asc" } }),
      this.prisma.cpmLabReading.findMany({ ...where, orderBy: { observedAt: "asc" } }),
      this.prisma.cpmLabAlert.findMany({ ...where, orderBy: { createdAt: "asc" } }),
      this.prisma.cpmLabManualEvent.findMany({ ...where, orderBy: { occurredAt: "asc" } }),
      this.prisma.cpmLabFloodEvent.findMany({ ...where, orderBy: { occurredAt: "asc" } }),
    ]);
    return {
      run: toRun(run),
      requests: requests.map(toRequest),
      readings: readings.map((row) => ({
        requestId: row.requestId,
        runId: row.runId,
        channelId: row.channelId,
        postId: row.postId,
        telegramMessageId: row.telegramMessageId,
        views: row.views,
        resultKind: row.resultKind,
        observedAt: row.observedAt,
        source: row.source,
      })),
      alerts: alerts.map((row) => ({
        runId: row.runId,
        kind: row.kind,
        detail: row.detail,
        createdAt: row.createdAt,
      })),
      manualEvents: manualEvents.map((row) => ({
        runId: row.runId,
        kind: row.kind,
        occurredAt: row.occurredAt,
        note: row.note,
      })),
      floodEvents: floodEvents.map((row) => ({
        reader: row.reader,
        runId: row.runId,
        requestId: row.requestId,
        seconds: row.seconds,
        occurredAt: row.occurredAt,
        nextAllowedAt: row.nextAllowedAt,
      })),
    };
  }

  async listRuns(limit: number) {
    const rows = await this.prisma.cpmLabRun.findMany({ orderBy: { startedAt: "desc" }, take: limit });
    return rows.map(toRun);
  }

  async countStarted() {
    return this.prisma.cpmLabRpcRequest.count({ where: { status: "STARTED" } });
  }

  async readerStates(): Promise<ReaderState[]> {
    const rows = await this.prisma.cpmLabReaderState.findMany({ orderBy: { reader: "asc" } });
    return rows.map((row) => toState(row.reader, row));
  }

  async close() {
    await this.prisma.$disconnect();
  }
}

const LOCK_REQUEST_ROW_SQL = `SELECT id FROM "cpm_lab_rpc_requests" WHERE id = $1 FOR UPDATE`;

async function countPriorFloodEvents(
  tx: LabPrismaTx,
  reader: LabReader,
  at: Date,
  excludeId: string | null,
): Promise<number> {
  const since = new Date(at.getTime() - LAB_LIMITS.floodWindowMs);
  return tx.cpmLabFloodEvent.count({
    where: {
      reader,
      occurredAt: { gt: since, lte: at },
      ...(excludeId === null ? {} : { id: { not: excludeId } }),
    },
  });
}

function laterOf(left: Date | null, right: Date): Date {
  return left !== null && left.getTime() > right.getTime() ? left : right;
}

export function isUniqueViolation(error: unknown): boolean {
  if (typeof error !== "object" || error === null || !("code" in error)) {
    return false;
  }
  const code = (error as { code: unknown }).code;
  return code === "P2002" || code === "23505";
}

function toRequest(row: any): StoredRequest {
  return {
    id: row.id,
    runId: row.runId,
    reader: row.reader,
    channelId: row.channelId,
    idempotencyKey: row.idempotencyKey,
    source: row.source,
    purpose: row.purpose,
    rpcMethod: row.rpcMethod,
    slotIndex: row.slotIndex,
    retryOfId: row.retryOfId,
    status: row.status,
    errorClass: row.errorClass,
    requestedAt: row.requestedAt,
    finishedAt: row.finishedAt,
    durationMs: row.durationMs,
    floodWaitSeconds: row.floodWaitSeconds,
  };
}

function toRun(row: any): StoredRun {
  return {
    id: row.id,
    label: row.label,
    kind: row.kind,
    status: row.status,
    settings: row.settings,
    libraryTraffic: row.libraryTraffic,
    stopReason: row.stopReason,
    startedAt: row.startedAt,
    stoppedAt: row.stoppedAt,
  };
}

function toState(reader: LabReader, row: any): ReaderState {
  return {
    reader,
    nextAllowedAt: row?.nextAllowedAt ?? null,
    stoppedAt: row?.stoppedAt ?? null,
    stopReason: row?.stopReason ?? null,
  };
}
