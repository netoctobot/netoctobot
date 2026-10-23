import pg from "pg";
import type { LabEnv } from "./config.js";
import { LabLockDeniedError, openDedicatedPostgresLock } from "./lock.js";
import { openPrismaLabStore } from "./prisma-store.js";
import type { RequestSpec } from "./store.js";
import { assertIsolatedTestDatabase, createTemporaryLabSchema } from "./lab-test-database.js";

/**
 * lab.sh test-db. Applies the lab migrations in a temporary schema of
 * LAB_TEST_DATABASE_URL, checks the constraints the worker relies on, and
 * drops only that schema. No Telegram call is made.
 */
export async function runTestDatabaseCheck(env: LabEnv, out: (line: string) => void): Promise<number> {
  const testUrl = assertIsolatedTestDatabase(env);
  const temporary = await createTemporaryLabSchema(testUrl);
  const checks: Record<string, "passed" | "failed"> = {};
  const record = (name: string, passed: boolean) => {
    checks[name] = passed ? "passed" : "failed";
  };
  try {
    const store = await openPrismaLabStore(temporary.url);
    try {
      const now = new Date();
      const channel = await store.ensureChannel(1_000_000_001n);
      const post = await store.ensurePost(channel.id, 7n);
      const run = await store.createRun({ label: "test-db", kind: "PREFLIGHT", settings: {}, startedAt: now });
      const spec: RequestSpec = {
        runId: run.id,
        reader: "BOT_CHANNELS_GET_MESSAGES",
        channelId: channel.id,
        idempotencyKey: "check:1",
        source: "INJECTED",
        purpose: "PREFLIGHT_READ",
        rpcMethod: "channels.GetMessages",
        slotIndex: null,
        retryOfId: null,
      };
      const first = await store.beginRequest(spec, now);
      const second = await store.beginRequest(spec, now);
      record("same_key_is_not_created_twice", first.kind === "created" && second.kind === "existing");
      let conflict = false;
      try {
        await store.beginRequest({ ...spec, reader: "USER_GET_MESSAGES_VIEWS" }, now);
      } catch (error) {
        conflict = error instanceof Error && error.name === "RequestIdentityConflictError";
      }
      record("identity_conflict_rejected", conflict && (await store.countRunRequests(run.id)) === 1);
      await store.completeRequest({
        requestId: first.request.id,
        observations: [{ postId: post.id, telegramMessageId: 7n, views: 3, resultKind: "MESSAGE" }],
        observedAt: now,
        durationMs: 1,
      });
      record("reading_update_rejected", await updateRejected(temporary.url, temporary.schema));
      const floodRequest = await store.beginRequest({ ...spec, idempotencyKey: "check:flood" }, now);
      const floodInput = {
        requestId: floodRequest.request.id,
        reader: "BOT_CHANNELS_GET_MESSAGES" as const,
        runId: run.id,
        seconds: 5,
        finishedAt: now,
        durationMs: 1,
      };
      const flood = await store.failRequestWithFlood(floodInput);
      const replay = await store.failRequestWithFlood(floodInput);
      const state = await store.readerState("BOT_CHANNELS_GET_MESSAGES");
      record(
        "flood_wait_persisted_once",
        state.nextAllowedAt?.getTime() === flood.nextAllowedAt.getTime() && replay.replayed,
      );
      await store.beginRequest({ ...spec, idempotencyKey: "check:2" }, now);
      const abandoned = await store.abandonInterrupted(new Date());
      record(
        "started_becomes_abandoned_and_stops_reader",
        abandoned.requests === 1 && abandoned.stoppedReaders.includes("BOT_CHANNELS_GET_MESSAGES"),
      );
    } finally {
      await store.close();
    }
    const holder = await openDedicatedPostgresLock(testUrl);
    let denied = false;
    try {
      await openDedicatedPostgresLock(testUrl);
    } catch (error) {
      denied = error instanceof LabLockDeniedError;
    } finally {
      await holder.close();
    }
    record("second_lock_holder_denied", denied);
  } finally {
    await temporary.drop();
  }
  const passed = Object.values(checks).every((value) => value === "passed");
  out(JSON.stringify({ schema: temporary.schema, schemaDropped: true, checks, passed }, null, 2));
  return passed ? 0 : 1;
}

async function updateRejected(url: string, schema: string): Promise<boolean> {
  const plain = new URL(url);
  plain.searchParams.delete("schema");
  const client = new pg.Client({ connectionString: plain.toString() });
  await client.connect();
  try {
    await client.query(`SET search_path TO "${schema}"`);
    await client.query(`UPDATE "cpm_lab_readings" SET "views" = 99`);
    return false;
  } catch (error) {
    return (error as { code?: string }).code === "23001";
  } finally {
    await client.end().catch(() => undefined);
  }
}
