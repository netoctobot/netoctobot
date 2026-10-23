import assert from "node:assert/strict";
import test from "node:test";
import { errors } from "teleproto";
import { executeLabRequest, LabPersistenceError } from "./executor.js";
import { LAB_LIMITS } from "./policy.js";
import { RequestIdentityConflictError } from "./reading-log.js";
import { MemoryLabStore, type RequestSpec } from "./store.js";
import { FakeClock, FakeLock } from "./testing/fakes.js";

async function setup() {
  const store = new MemoryLabStore();
  const clock = new FakeClock();
  const lock = new FakeLock();
  const channel = await store.ensureChannel(1n);
  const post = await store.ensurePost(channel.id, 42n);
  const run = await store.createRun({ label: "t", kind: "TRIAL", settings: {}, startedAt: clock.now() });
  const spec: RequestSpec = {
    runId: run.id,
    reader: "BOT_CHANNELS_GET_MESSAGES",
    channelId: channel.id,
    idempotencyKey: "trial:r0:BOT_CHANNELS_GET_MESSAGES",
    source: "TELEGRAM",
    purpose: "TRIAL_READ",
    rpcMethod: "channels.GetMessages",
    slotIndex: 0,
    retryOfId: null,
  };
  const row = (views: number) => [{ postId: post.id, telegramMessageId: 42n, views, resultKind: "MESSAGE" as const }];
  const controller = new AbortController();
  const base = { lock, store, now: () => clock.now(), lockSignal: controller.signal };
  return { store, clock, lock, spec, row, controller, base };
}

test("STARTED is committed before send, then one completion stores readings", async () => {
  const { store, spec, row, base } = await setup();
  let statusDuringSend: string | undefined;
  const outcome = await executeLabRequest({
    ...base,
    spec,
    send: async () => {
      statusDuringSend = store.requests[0]?.status;
      return row(5);
    },
  });
  assert.equal(statusDuringSend, "STARTED");
  assert.equal(outcome.kind, "succeeded");
  assert.equal(store.requests[0]?.status, "SUCCEEDED");
  assert.equal(store.readings.length, 1);
});

test("a key that exists in any status is never sent again", async () => {
  for (const status of ["STARTED", "FAILED", "ABANDONED", "SUCCEEDED"] as const) {
    const { store, spec, row, base } = await setup();
    await store.beginRequest(spec, new Date());
    store.requests[0]!.status = status;
    let sent = 0;
    const outcome = await executeLabRequest({ ...base, spec, send: async () => (sent++, row(1)) });
    assert.equal(outcome.kind, "existing", status);
    assert.equal(sent, 0, status);
    assert.equal(store.requests.length, 1);
  }
});

test("identity conflict on a reused key rejects without writing", async () => {
  const { store, spec, row, base } = await setup();
  await store.beginRequest(spec, new Date());
  await assert.rejects(
    executeLabRequest({ ...base, spec: { ...spec, reader: "USER_GET_MESSAGES_VIEWS" }, send: async () => row(1) }),
    RequestIdentityConflictError,
  );
  assert.equal(store.requests.length, 1);
  assert.equal(store.readings.length, 0);
});

test("lock lost before send: no row and no RPC", async () => {
  const { store, spec, row, base, lock } = await setup();
  lock.held = false;
  let sent = false;
  const outcome = await executeLabRequest({ ...base, spec, send: async () => ((sent = true), row(1)) });
  assert.equal(outcome.kind, "lock_lost");
  assert.equal(sent, false);
  assert.equal(store.requests.length, 0);
});

test("lock lost in flight: the call is aborted, the row stays STARTED, and a late reply is not stored", async () => {
  const { store, spec, row, lock, controller } = await setup();
  lock.onLost(() => controller.abort());
  let abortedSignal = false;
  const outcome = await executeLabRequest({
    lock,
    store,
    now: () => new Date(),
    lockSignal: controller.signal,
    spec,
    send: async (signal) => {
      signal.addEventListener("abort", () => (abortedSignal = true));
      lock.lose();
      return row(9);
    },
  });
  assert.equal(outcome.kind, "lock_lost");
  assert.equal(abortedSignal, true);
  assert.equal(store.requests[0]?.status, "STARTED");
  assert.equal(store.readings.length, 0);
});

test("errors are stored as FAILED with the classified flood wait", async () => {
  const { store, spec, base } = await setup();
  const outcome = await executeLabRequest({
    ...base,
    spec,
    send: async () => {
      throw new errors.FloodWaitError({ capture: "12", request: undefined } as never);
    },
  });
  assert.equal(outcome.kind, "failed");
  assert.equal(store.requests[0]?.status, "FAILED");
  assert.equal(store.requests[0]?.errorClass, "FLOOD_WAIT");
  assert.equal(store.requests[0]?.floodWaitSeconds, 12);
});

test("a failed completion write stops with LabPersistenceError and leaves STARTED", async () => {
  const { store, spec, row, base } = await setup();
  store.failNextComplete = true;
  await assert.rejects(executeLabRequest({ ...base, spec, send: async () => row(1) }), LabPersistenceError);
  assert.equal(store.requests[0]?.status, "STARTED");
  assert.equal(store.readings.length, 0);
});

test("the per-run cap stops before a new row", async () => {
  const { store, spec, row, base } = await setup();
  for (let index = 0; index < LAB_LIMITS.maxRequestsPerRun; index += 1) {
    await store.beginRequest({ ...spec, idempotencyKey: `k${index}` }, new Date());
  }
  const outcome = await executeLabRequest({ ...base, spec, send: async () => row(1) });
  assert.equal(outcome.kind, "cap_reached");
  assert.equal(store.requests.length, LAB_LIMITS.maxRequestsPerRun);
});
