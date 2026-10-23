import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import pg from "pg";
import { executeLabRequest } from "./executor.js";
import {
  assertIsolatedTestDatabase,
  createTemporaryLabSchema,
  type TemporaryLabSchema,
} from "./lab-test-database.js";
import { runTestDatabaseCheck } from "./lab-test-database-check.js";
import { LAB_LOCK_APPLICATION_NAME, LabLockDeniedError, openDedicatedPostgresLock, withLabLock } from "./lock.js";
import { openPrismaLabStore, type PrismaLabStore } from "./prisma-store.js";
import { RequestIdentityConflictError } from "./reading-log.js";
import { LabLockLostError, SessionExistsError, UNRESOLVED_STOP_REASON, type RequestSpec } from "./store.js";

/**
 * Runs only with LAB_TEST_DATABASE_URL, which must differ from LAB_DATABASE_URL
 * and DATABASE_URL. Each run creates schema cpm_lab_test_<hex> and drops it.
 */
const testUrl = process.env.LAB_TEST_DATABASE_URL ? assertIsolatedTestDatabase(process.env) : null;
const skip = testUrl === null ? "LAB_TEST_DATABASE_URL is not set" : false;

let temporary: TemporaryLabSchema;
let store: PrismaLabStore;
let channelId: string;
let postId: string;
let runId: string;

async function sql(text: string, params: unknown[] = []) {
  const client = new pg.Client({ connectionString: testUrl! });
  await client.connect();
  try {
    await client.query(`SET search_path TO "${temporary.schema}"`);
    return await client.query(text, params);
  } finally {
    await client.end();
  }
}

function spec(key: string, overrides: Partial<RequestSpec> = {}): RequestSpec {
  return {
    runId,
    reader: "BOT_CHANNELS_GET_MESSAGES",
    channelId,
    idempotencyKey: key,
    source: "TELEGRAM",
    purpose: "TRIAL_READ",
    rpcMethod: "channels.GetMessages",
    slotIndex: 0,
    retryOfId: null,
    ...overrides,
  };
}

before(async () => {
  if (skip) return;
  temporary = await createTemporaryLabSchema(testUrl!);
  store = await openPrismaLabStore(temporary.url);
  const channel = await store.ensureChannel(1234567890n);
  channelId = channel.id;
  postId = (await store.ensurePost(channelId, 42n)).id;
  runId = (await store.createRun({ label: "pg", kind: "TRIAL", settings: { a: 1 }, startedAt: new Date() })).id;
});

after(async () => {
  if (skip) return;
  await store.close();
  await temporary.drop();
  const remaining = await new pg.Client({ connectionString: testUrl! });
  await remaining.connect();
  const result = await remaining.query("SELECT 1 FROM information_schema.schemata WHERE schema_name = $1", [temporary.schema]);
  await remaining.end();
  assert.equal(result.rowCount, 0, "temporary schema was dropped");
});

test("both lab migrations apply in the temporary schema", { skip }, async () => {
  const tables = await sql(
    "SELECT table_name FROM information_schema.tables WHERE table_schema = $1 ORDER BY table_name",
    [temporary.schema],
  );
  assert.deepEqual(
    tables.rows.map((row) => row.table_name),
    [
      "cpm_lab_alerts",
      "cpm_lab_channels",
      "cpm_lab_flood_events",
      "cpm_lab_manual_events",
      "cpm_lab_posts",
      "cpm_lab_reader_states",
      "cpm_lab_readings",
      "cpm_lab_rpc_requests",
      "cpm_lab_runs",
      "cpm_lab_sessions",
    ],
  );
  const publicTables = await sql("SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema = 'public' AND table_name LIKE 'cpm_lab_%'");
  assert.equal(publicTables.rows[0]?.n, 0);
});

test("two concurrent begins with one key create one row", { skip }, async () => {
  const results = await Promise.all([store.beginRequest(spec("concurrent"), new Date()), store.beginRequest(spec("concurrent"), new Date())]);
  assert.deepEqual(results.map((result) => result.kind).sort(), ["created", "existing"]);
  const count = await sql(`SELECT count(*)::int AS n FROM cpm_lab_rpc_requests WHERE "idempotencyKey" = 'concurrent'`);
  assert.equal(count.rows[0]?.n, 1);
});

test("an identity conflict leaves no new rows", { skip }, async () => {
  await store.beginRequest(spec("identity"), new Date());
  const before = await store.countRunRequests(runId);
  for (const override of [{ reader: "USER_GET_MESSAGES_VIEWS" as const }, { source: "INJECTED" as const }]) {
    await assert.rejects(store.beginRequest(spec("identity", override), new Date()), RequestIdentityConflictError);
  }
  assert.equal(await store.countRunRequests(runId), before);
});

test("completion is one transaction and readings reject UPDATE", { skip }, async () => {
  const begun = await store.beginRequest(spec("complete"), new Date());
  const reading = { postId, telegramMessageId: 42n, views: 7, resultKind: "MESSAGE" as const };
  await assert.rejects(
    store.completeRequest({ requestId: begun.request.id, observations: [reading, reading], observedAt: new Date(), durationMs: 5 }),
  );
  const status = await sql(`SELECT status FROM cpm_lab_rpc_requests WHERE id = $1`, [begun.request.id]);
  assert.equal(status.rows[0]?.status, "STARTED");
  assert.equal((await sql(`SELECT count(*)::int AS n FROM cpm_lab_readings WHERE "requestId" = $1`, [begun.request.id])).rows[0]?.n, 0);

  await store.completeRequest({ requestId: begun.request.id, observations: [reading], observedAt: new Date(), durationMs: 5 });
  await assert.rejects(store.completeRequest({ requestId: begun.request.id, observations: [reading], observedAt: new Date(), durationMs: 5 }));
  await assert.rejects(sql(`UPDATE cpm_lab_readings SET views = 8`), (error: { code?: string }) => error.code === "23001");
  const views = await sql(`SELECT views FROM cpm_lab_readings WHERE "requestId" = $1`, [begun.request.id]);
  assert.deepEqual(views.rows, [{ views: 7 }]);
});

test("flood events persist, reject UPDATE, and use a rolling 24-hour window", { skip }, async () => {
  const now = Date.now();
  const fail = async (key: string, at: number) => {
    const begun = await store.beginRequest(spec(key, { reader: "USER_GET_MESSAGES_VIEWS" }), new Date(at));
    return store.failRequestWithFlood({ requestId: begun.request.id, reader: "USER_GET_MESSAGES_VIEWS", runId, seconds: 5, finishedAt: new Date(at), durationMs: 1 });
  };
  const old = await fail("flood:old", now - 25 * 3600_000);
  assert.equal(old.priorEventsInWindow, 0);
  const first = await fail("flood:1", now);
  assert.equal(first.priorEventsInWindow, 0);
  const second = await fail("flood:2", now + 1000);
  assert.equal(second.stopReader, false);
  const third = await fail("flood:3", now + 2000);
  assert.equal(third.stopReader, true);
  const state = await store.readerState("USER_GET_MESSAGES_VIEWS");
  assert.equal(state.stopReason, "third_flood_wait_in_24h");
  assert.equal(state.nextAllowedAt?.getTime(), now + 7000);
  await assert.rejects(sql(`UPDATE cpm_lab_flood_events SET seconds = 1`), (error: { code?: string }) => error.code === "23001");
  const cleared = await store.clearReaderStop("USER_GET_MESSAGES_VIEWS");
  assert.equal(cleared.stoppedAt, null);
  assert.equal(cleared.nextAllowedAt?.getTime(), now + 7000);
});

test("a failure inside the flood transaction rolls back the request, the event, and the reader state", { skip }, async () => {
  const at = new Date(Date.now() + 10 * 60_000);
  const begun = await store.beginRequest(spec("flood:atomic"), at);
  const input = { requestId: begun.request.id, reader: "BOT_CHANNELS_GET_MESSAGES" as const, runId, seconds: 90, finishedAt: at, durationMs: 1 };
  const stateBefore = await store.readerState("BOT_CHANNELS_GET_MESSAGES");
  await sql(`CREATE FUNCTION cpm_lab_test_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'simulated write failure'; END $$`);
  await sql(`CREATE TRIGGER cpm_lab_test_fail BEFORE INSERT OR UPDATE ON cpm_lab_reader_states FOR EACH ROW EXECUTE FUNCTION cpm_lab_test_fail()`);
  try {
    await assert.rejects(store.failRequestWithFlood(input));
  } finally {
    await sql(`DROP TRIGGER cpm_lab_test_fail ON cpm_lab_reader_states`);
    await sql(`DROP FUNCTION cpm_lab_test_fail()`);
  }
  const row = await sql(`SELECT status, "errorClass" FROM cpm_lab_rpc_requests WHERE id = $1`, [begun.request.id]);
  assert.deepEqual(row.rows[0], { status: "STARTED", errorClass: null });
  assert.equal((await sql(`SELECT count(*)::int AS n FROM cpm_lab_flood_events WHERE "requestId" = $1`, [begun.request.id])).rows[0]?.n, 0);
  assert.deepEqual(await store.readerState("BOT_CHANNELS_GET_MESSAGES"), stateBefore);

  const firstCalls = await Promise.all([store.failRequestWithFlood(input), store.failRequestWithFlood(input)]);
  assert.deepEqual(firstCalls.map((call) => call.replayed).sort(), [false, true]);
  const stored = firstCalls.find((call) => !call.replayed)!;
  assert.equal(stored.nextAllowedAt.getTime(), at.getTime() + 90_000);
  const replays = await Promise.all([store.failRequestWithFlood(input), store.failRequestWithFlood(input)]);
  assert.deepEqual(replays.map((replay) => [replay.replayed, replay.priorEventsInWindow]), [[true, stored.priorEventsInWindow], [true, stored.priorEventsInWindow]]);
  assert.equal((await sql(`SELECT count(*)::int AS n FROM cpm_lab_flood_events WHERE "requestId" = $1`, [begun.request.id])).rows[0]?.n, 1);
  await assert.rejects(
    sql(`INSERT INTO cpm_lab_flood_events (id, reader, "runId", "requestId", seconds, "occurredAt", "nextAllowedAt") VALUES ('dup', 'BOT_CHANNELS_GET_MESSAGES', $1, $2, 1, now(), now())`, [runId, begun.request.id]),
    (error: { code?: string }) => error.code === "23505",
  );
  assert.equal((await store.readerState("BOT_CHANNELS_GET_MESSAGES")).nextAllowedAt?.getTime(), at.getTime() + 90_000);
});

test("sessions refuse overwrite without replace and are written on the lock connection", { skip }, async () => {
  const holder = await openDedicatedPostgresLock(testUrl!);
  const guard = holder.sessionGuard;
  try {
    await store.saveSession("BOT_CHANNELS_GET_MESSAGES", "cipher-1", false, guard);
    await assert.rejects(store.saveSession("BOT_CHANNELS_GET_MESSAGES", "cipher-2", false, guard), SessionExistsError);
    await store.saveSession("BOT_CHANNELS_GET_MESSAGES", "cipher-3", true, guard);
    assert.equal((await store.loadSession("BOT_CHANNELS_GET_MESSAGES"))?.ciphertext, "cipher-3");
  } finally {
    await holder.close();
  }
  await assert.rejects(store.saveSession("BOT_CHANNELS_GET_MESSAGES", "cipher-5", true, holder.sessionGuard), LabLockLostError);
  assert.equal((await store.loadSession("BOT_CHANNELS_GET_MESSAGES"))?.ciphertext, "cipher-3");
});

test("a lock connection lost after the check and before the write keeps the old session", { skip }, async () => {
  const holder = await openDedicatedPostgresLock(testUrl!);
  let successor: Awaited<ReturnType<typeof openDedicatedPostgresLock>> | null = null;
  try {
    await store.saveSession("USER_GET_MESSAGES_VIEWS", "cipher-old", false, holder.sessionGuard);
    holder.lock.beforeSessionWrite = async () => {
      const killer = new pg.Client({ connectionString: testUrl!, application_name: "cpm-lab-test" });
      await killer.connect();
      try {
        await killer.query("SELECT pg_terminate_backend($1)", [holder.backendPid]);
      } finally {
        await killer.end().catch(() => undefined);
      }
      for (let attempt = 0; attempt < 25 && successor === null; attempt += 1) {
        try {
          successor = await openDedicatedPostgresLock(testUrl!);
        } catch (error) {
          if (!(error instanceof LabLockDeniedError)) throw error;
          await new Promise((resolve) => setTimeout(resolve, 40));
        }
      }
      if (successor === null) {
        throw new Error("the advisory lock did not move to a new connection");
      }
    };
    await assert.rejects(
      store.saveSession("USER_GET_MESSAGES_VIEWS", "cipher-new", true, holder.sessionGuard),
      LabLockLostError,
    );
    assert.equal((await store.loadSession("USER_GET_MESSAGES_VIEWS"))?.ciphertext, "cipher-old");
    assert.equal(successor?.lock.isHeld(), true);
  } finally {
    holder.lock.beforeSessionWrite = null;
    await successor?.close().catch(() => undefined);
    await holder.close().catch(() => undefined);
  }
});

test("a second lock holder is denied, and withLabLock releases the connection", { skip }, async () => {
  await withLabLock(testUrl!, async () => {
    await assert.rejects(openDedicatedPostgresLock(testUrl!), LabLockDeniedError);
  });
  const connections = await sql("SELECT count(*)::int AS n FROM pg_stat_activity WHERE application_name = $1", [LAB_LOCK_APPLICATION_NAME]);
  assert.equal(connections.rows[0]?.n, 0);
  const again = await openDedicatedPostgresLock(testUrl!);
  await again.close();
});

test("pg_terminate_backend aborts the in-flight request; the next holder abandons it", { skip }, async () => {
  const holder = await openDedicatedPostgresLock(testUrl!);
  const controller = new AbortController();
  holder.lock.onLost(() => controller.abort());
  let aborted = false;
  const outcome = await executeLabRequest({
    lock: holder.lock,
    store,
    now: () => new Date(),
    deadline: null,
    lockSignal: controller.signal,
    spec: spec("terminated"),
    send: (signal) =>
      new Promise((resolve, reject) => {
        signal.addEventListener("abort", () => {
          aborted = true;
          reject(new Error("aborted"));
        });
        void sql("SELECT pg_terminate_backend($1)", [holder.backendPid]);
        setTimeout(() => resolve([{ postId, telegramMessageId: 42n, views: 1, resultKind: "MESSAGE" }]), 5_000);
      }),
  });
  assert.equal(outcome.kind, "lock_lost");
  assert.equal(aborted, true);
  assert.equal(holder.lock.isHeld(), false);
  const row = await sql(`SELECT id, status FROM cpm_lab_rpc_requests WHERE "idempotencyKey" = 'terminated'`);
  assert.equal(row.rows[0]?.status, "STARTED");
  await holder.close();

  await withLabLock(testUrl!, async () => {
    const result = await store.abandonInterrupted(new Date());
    assert.ok(result.requests >= 1);
    assert.ok(result.stoppedReaders.includes("BOT_CHANNELS_GET_MESSAGES"));
  });
  const after = await sql(`SELECT status, "errorClass" FROM cpm_lab_rpc_requests WHERE "idempotencyKey" = 'terminated'`);
  assert.deepEqual(after.rows[0], { status: "ABANDONED", errorClass: "ABANDONED_MAY_HAVE_REACHED_TELEGRAM" });
  const state = await store.readerState("BOT_CHANNELS_GET_MESSAGES");
  assert.equal(state.stopReason, UNRESOLVED_STOP_REASON);
  assert.equal(await store.countStarted(), 0);
});

test("the lab.sh test-db self check passes and drops its own schema", { skip }, async () => {
  const lines: string[] = [];
  const code = await runTestDatabaseCheck({ LAB_TEST_DATABASE_URL: testUrl! }, (line) => lines.push(line));
  const result = JSON.parse(lines.join("\n"));
  assert.equal(code, 0, lines.join("\n"));
  assert.equal(result.passed, true);
  const exists = await sql("SELECT 1 FROM information_schema.schemata WHERE schema_name = $1", [result.schema]);
  assert.equal(exists.rowCount, 0);
});
