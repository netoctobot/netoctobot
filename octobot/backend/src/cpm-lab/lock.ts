import pg from "pg";

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

  async probe(): Promise<boolean> {
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
}

export const LAB_LOCK_APPLICATION_NAME = "cpm-lab-lock";

/** backendPid is pg_backend_pid() of the connection that holds the lock. */
export type LabLockInfo = { backendPid: number | null };

/**
 * A pg.Client outside any Prisma pool. The advisory lock lives as long as
 * this connection. TCP keepalive lets a dead peer surface as "error" or "end",
 * which marks the lock lost.
 */
export async function openDedicatedPostgresLock(connectionString: string): Promise<{
  lock: AdvisorySessionLock;
  backendPid: number;
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
  return {
    lock,
    backendPid,
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
  const { lock, backendPid, close } = await openDedicatedPostgresLock(connectionString);
  try {
    return await run(lock, { backendPid });
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
