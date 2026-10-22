import assert from "node:assert/strict";
import test from "node:test";
import {
  ADVISORY_LOCK_SQL,
  AdvisorySessionLock,
  LabLockDeniedError,
  type DedicatedDbClient,
} from "./lock.js";
import { runPollLoop } from "./poll-loop.js";

class FakeConnection implements DedicatedDbClient {
  readonly queries: string[] = [];
  locked = true;
  probeThrows = false;
  private readonly listeners: Record<"error" | "end", Array<() => void>> = {
    error: [],
    end: [],
  };

  async query(sql: string): Promise<{ rows: Array<Record<string, unknown>> }> {
    this.queries.push(sql);
    if (sql.includes("pg_try_advisory_lock")) {
      return { rows: [{ locked: this.locked }] };
    }
    if (this.probeThrows) {
      throw new Error("connection ended");
    }
    return { rows: [{ held: this.locked }] };
  }

  on(event: "error" | "end", listener: () => void): void {
    this.listeners[event].push(listener);
  }

  emit(event: "error" | "end"): void {
    this.locked = false;
    for (const listener of this.listeners[event]) {
      listener();
    }
  }
}

test("a second worker is denied when the advisory lock is held", async () => {
  const connection = new FakeConnection();
  connection.locked = false;
  const lock = new AdvisorySessionLock(connection);

  await assert.rejects(lock.acquire(), LabLockDeniedError);
  assert.equal(connection.queries[0], ADVISORY_LOCK_SQL);
  assert.equal(lock.isHeld(), false);
});

test("losing the lock during a poll stops the next Telegram request", async () => {
  const connection = new FakeConnection();
  const lock = new AdvisorySessionLock(connection);
  await lock.acquire();
  let calls = 0;

  const result = await runPollLoop({
    lock,
    requests: ["first", "second", "third"],
    transport: async () => {
      calls += 1;
      if (calls === 1) {
        connection.emit("end");
      }
    },
  });

  assert.equal(calls, 1);
  assert.equal(result.completed, 1);
  assert.equal(result.stoppedReason, "lock_lost");
  assert.equal(lock.isHeld(), false);
});

test("a failed lock probe during the loop stops Telegram requests", async () => {
  const connection = new FakeConnection();
  const lock = new AdvisorySessionLock(connection);
  await lock.acquire();
  connection.probeThrows = true;
  let calls = 0;

  const result = await runPollLoop({
    lock,
    requests: ["first"],
    transport: async () => {
      calls += 1;
    },
  });

  assert.equal(calls, 0);
  assert.equal(result.stoppedReason, "lock_lost");
  assert.equal(lock.isHeld(), false);
});
