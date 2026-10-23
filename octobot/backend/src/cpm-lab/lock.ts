import pg from "pg";
import { LabLockLostError, type LockQuery, type SessionWriteGuard } from "./store.js";

export const LAB_ADVISORY_LOCK_CLASSID = 591_001;
export const LAB_ADVISORY_LOCK_OBJID = 2_026_1022;

export const ADVISORY_LOCK_SQL =
  "SELECT pg_try_advisory_lock($1::integer, $2::integer) AS locked";

export const ADVISORY_LOCK_HELD_SQL = `SELECT EXISTS (
  SELECT 1 FROM pg_locks
  WHERE locktype = 'advisory'
    AND granted = true
    AND pid = pg_backend_pid()
    AND classid = $1::integer
    AND objid = $2::integer
) AS held`;

export class LabLockDeniedError extends Error {
  constructor() {
    super("CPM lab advisory lock is already held");
    this.name = "LabLockDeniedError";
  }
}

export class TelegramPausedError extends Error {
  constructor(readonly reason: string) {
    super(`Telegram requests are paused: ${reason}`);
    this.name = "TelegramPausedError";
  }
}

export type DedicatedDbClient = {
  query: (
    sql: string,
    params?: readonly unknown[],
  ) => Promise<{ rows: Array<Record<string, unknown>> }>;
  on: (event: "error" | "end", listener: () => void) => void;
};

export class AdvisorySessionLock {
  private held = false;
  private lost = false;
  private readonly lostListeners: Array<() => void> = [];

  constructor(private readonly client: DedicatedDbClient) {}

  isHeld(): boolean {
    return this.held && !this.lost;
  }

  onLost(listener: () => void): void {
    this.lostListeners.push(listener);
  }

  markLost(): void {
    if (this.lost) {
      return;
    }
    this.lost = true;
    this.held = false;
    for (const listener of this.lostListeners) {
      listener();
    }
  }

  async acquire(): Promise<void> {
    const result = await this.client.query(ADVISORY_LOCK_SQL, [
      LAB_ADVISORY_LOCK_CLASSID,
      LAB_ADVISORY_LOCK_OBJID,
    ]);
    if (result.rows[0]?.locked !== true) {
      throw new LabLockDeniedError();
    }
    this.held = true;
    this.client.on("error", () => this.markLost());
    this.client.on("end", () => this.markLost());
  }

  /**
   * Test seam. Runs after this backend is confirmed to hold the lock and
   * before the session statements. Production leaves it null. The callback
   * must not use this lock's connection, or it deadlocks the query queue.
   */
  beforeSessionWrite: (() => Promise<void>) | null = null;
  private tail: Promise<void> = Promise.resolve();

  async probe(): Promise<boolean> {
    return this.enqueue(() => this.probeNow());
  }

  /**
   * BEGIN, confirm this backend holds the advisory lock, run the write, COMMIT.
   * All of it is on the lock connection, so a disconnect rolls the write back
   * before any other backend can acquire the lock.
   */
  async inLockTransaction(write: (query: LockQuery) => Promise<void>): Promise<void> {
    await this.enqueue(() => this.transactionNow(write));
  }

  private enqueue<T>(run: () => Promise<T>): Promise<T> {
    const result = this.tail.then(run, run);
    this.tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  private async probeNow(): Promise<boolean> {
    if (!this.isHeld()) {
      return false;
    }
    try {
      const result = await this.client.query(ADVISORY_LOCK_HELD_SQL, [
        LAB_ADVISORY_LOCK_CLASSID,
        LAB_ADVISORY_LOCK_OBJID,
      ]);
      if (result.rows[0]?.held === true) {
        return true;
      }
    } catch {
      this.markLost();
      return false;
    }
    this.markLost();
    return false;
  }

  private async transactionNow(write: (query: LockQuery) => Promise<void>): Promise<void> {
    if (!this.isHeld()) {
      throw new LabLockLostError();
    }
    await this.client.query("BEGIN");
    try {
      const result = await this.client.query(ADVISORY_LOCK_HELD_SQL, [
        LAB_ADVISORY_LOCK_CLASSID,
        LAB_ADVISORY_LOCK_OBJID,
      ]);
      if (result.rows[0]?.held !== true) {
        this.markLost();
        throw new LabLockLostError();
      }
      if (this.beforeSessionWrite) {
        await this.beforeSessionWrite();
      }
      if (!this.isHeld()) {
        throw new LabLockLostError();
      }
      await write((sql, params) => this.client.query(sql, params));
      if (!this.isHeld()) {
        throw new LabLockLostError();
      }
      await this.client.query("COMMIT");
    } catch (error) {
      await this.client.query("ROLLBACK").catch(() => undefined);
      if (error instanceof LabLockLostError) {
        throw error;
      }
      if (isDisconnect(error)) {
        this.markLost();
        throw new LabLockLostError();
      }
      throw error;
    }
  }
}

function isDisconnect(error: unknown): boolean {
  if (typeof error !== "object" || error === null) {
    return false;
  }
  const code = "code" in error ? String((error as { code: unknown }).code) : "";
  if (["57P01", "57P02", "57P03", "08006", "08003", "08000", "ECONNRESET", "EPIPE"].includes(code)) {
    return true;
  }
  const message = "message" in error ? String((error as { message: unknown }).message) : "";
  return /terminated|not queryable|connection (ended|closed|reset)|administrator command/i.test(message);
}

export const LAB_LOCK_APPLICATION_NAME = "cpm-lab-lock";

/** backendPid is pg_backend_pid() of the connection that holds the lock. */
export type LabLockInfo = {
  backendPid: number | null;
  sessionGuard: SessionWriteGuard;
};

/**
 * A pg.Client outside any Prisma pool. The advisory lock lives as long as
 * this connection. TCP keepalive lets a dead peer surface as "error" or "end",
 * which marks the lock lost.
 */
export async function openDedicatedPostgresLock(connectionString: string): Promise<{
  lock: AdvisorySessionLock;
  backendPid: number;
  sessionGuard: SessionWriteGuard;
  close: () => Promise<void>;
}> {
  const client = new pg.Client({
    connectionString,
    keepAlive: true,
    application_name: LAB_LOCK_APPLICATION_NAME,
  });
  client.on("error", () => undefined);
  await client.connect();
  const pidResult = await client.query("SELECT pg_backend_pid() AS pid");
  const backendPid = Number(pidResult.rows[0]?.pid);
  const adapted: DedicatedDbClient = {
    async query(sql, params) {
      const result = await client.query(sql, params as unknown[] | undefined);
      return { rows: result.rows as Array<Record<string, unknown>> };
    },
    on(event, listener) {
      client.on(event, listener);
    },
  };
  const lock = new AdvisorySessionLock(adapted);
  try {
    await lock.acquire();
  } catch (error) {
    await client.end().catch(() => undefined);
    throw error;
  }
  const sessionGuard: SessionWriteGuard = {
    backendPid,
    isHeld: () => lock.isHeld(),
    inLockTransaction: (write) => lock.inLockTransaction(write),
  };
  return {
    lock,
    backendPid,
    sessionGuard,
    close: async () => {
      lock.markLost();
      await client.end().catch(() => undefined);
    },
  };
}

export async function withLabLock<T>(
  connectionString: string,
  run: (lock: AdvisorySessionLock, info: LabLockInfo) => Promise<T>,
): Promise<T> {
  const { lock, backendPid, sessionGuard, close } = await openDedicatedPostgresLock(connectionString);
  try {
    return await run(lock, { backendPid, sessionGuard });
  } finally {
    await close();
  }
}

/** Read-only check from another connection. It does not take the lock. */
export async function labLockHolders(connectionString: string): Promise<number> {
  const client = new pg.Client({ connectionString, application_name: "cpm-lab-status" });
  client.on("error", () => undefined);
  await client.connect();
  try {
    const result = await client.query(
      `SELECT count(*)::int AS holders FROM pg_locks
       WHERE locktype = 'advisory' AND granted = true
         AND classid = $1::integer AND objid = $2::integer
         AND database = (SELECT oid FROM pg_database WHERE datname = current_database())`,
      [LAB_ADVISORY_LOCK_CLASSID, LAB_ADVISORY_LOCK_OBJID],
    );
    return Number(result.rows[0]?.holders ?? 0);
  } finally {
    await client.end().catch(() => undefined);
  }
}
