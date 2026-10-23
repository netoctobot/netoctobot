import assert from "node:assert/strict";
import test from "node:test";
import { errors } from "teleproto";
import type { LabChannelConfig } from "./config.js";
import { buildLabReport } from "./report.js";
import { LabPersistenceError } from "./executor.js";
import { MemoryLabStore, UNRESOLVED_STOP_REASON } from "./store.js";
import { FakeClock, FakeLock, ScriptedTransport } from "./testing/fakes.js";
import { runLabWorker } from "./worker.js";

const CHANNEL: LabChannelConfig = { telegramChannelId: 1234567890n, postId: 42, username: "octolab_test", inviteHash: null };
const TRIAL = { rounds: 12, intervalMs: 300_000 };

function harness(store = new MemoryLabStore(), clock = new FakeClock(), trial = TRIAL) {
  const lock = new FakeLock();
  const bot = new ScriptedTransport("BOT_CHANNELS_GET_MESSAGES", clock);
  const user = new ScriptedTransport("USER_GET_MESSAGES_VIEWS", clock);
  const stop = new AbortController();
  const run = (kind: "TRIAL" | "PREFLIGHT" = "TRIAL", transports = [bot, user]) =>
    runLabWorker({
      store,
      lock,
      clock,
      transports,
      channel: CHANNEL,
      trial,
      kind,
      stopSignal: stop.signal,
      settings: {},
      libraryTraffic: () => ({ fake: { countedAtInvoke: { "updates.GetState": 1 } } }),
      log: () => undefined,
    });
  return { store, clock, lock, bot, user, stop, run };
}

const flood = (seconds: number) => ({ error: new errors.FloodWaitError({ capture: String(seconds), request: undefined } as never) });
const timeout = () => {
  const error = new Error("RPC timed out after 20000ms");
  error.name = "TimeoutError";
  return { error };
};

test("a full trial sends 24 base reads plus separate peer resolution, spaced by at least 3 seconds", async () => {
  const { store, run } = harness();
  const summary = await run();
  assert.equal(summary.stopReason, "completed");
  const base = store.requests.filter((request) => request.purpose === "TRIAL_READ");
  assert.equal(base.length, 24);
  assert.equal(store.requests.filter((request) => request.purpose === "PEER_RESOLUTION").length, 2);
  const times = store.requests.map((request) => request.requestedAt.getTime()).sort((a, b) => a - b);
  for (let index = 1; index < times.length; index += 1) {
    assert.ok(times[index]! - times[index - 1]! >= 3000);
  }
  assert.equal(store.readings.length, 24);

  const report = buildLabReport({ trial: await store.loadRunReport(null, "TRIAL"), preflight: null, readerStates: [] });
  assert.equal(report.commercialCpmEnabled, false);
  assert.equal(report.trial?.baseTrialReads.planned, 24);
  assert.equal(report.trial?.baseTrialReads.succeeded, 24);
  assert.equal(report.trial?.peerResolution.sent, 2);
  assert.equal(report.trial?.retries.sent, 0);
  assert.equal(report.trial?.counterRenewal.status, "undetermined");
  assert.deepEqual(report.trial?.libraryTraffic, { fake: { countedAtInvoke: { "updates.GetState": 1 } } });
});

test("timeout gets one linked retry after 30 seconds, then the slot is skipped", async () => {
  const { store, bot, run } = harness();
  bot.readScript = [timeout(), timeout()];
  await run();
  const first = store.requests.find((request) => request.idempotencyKey === "trial:r0:BOT_CHANNELS_GET_MESSAGES")!;
  const retry = store.requests.find((request) => request.idempotencyKey === "trial:r0:BOT_CHANNELS_GET_MESSAGES:retry1")!;
  assert.equal(first.status, "FAILED");
  assert.equal(retry.purpose, "RETRY");
  assert.equal(retry.retryOfId, first.id);
  assert.ok(retry.requestedAt.getTime() - first.finishedAt!.getTime() >= 30_000);
  assert.equal(store.requests.filter((request) => request.idempotencyKey.endsWith(":retry1:retry1")).length, 0);
  assert.equal(store.requests.filter((request) => request.purpose === "TRIAL_READ").length, 24);
});

test("FLOOD_WAIT is persisted, never retried, and later slots wait for nextAllowedAt", async () => {
  const { store, bot, run, clock } = harness();
  const start = clock.time;
  bot.readScript = [flood(400)];
  await run();
  assert.equal(store.floodEvents.length, 1);
  const state = await store.readerState("BOT_CHANNELS_GET_MESSAGES");
  assert.ok(state.nextAllowedAt);
  assert.equal(state.stoppedAt, null);
  const botReads = store.requests.filter((request) => request.reader === "BOT_CHANNELS_GET_MESSAGES" && request.purpose !== "PEER_RESOLUTION");
  assert.equal(botReads.some((request) => request.purpose === "RETRY"), false);
  const round1 = botReads.find((request) => request.slotIndex === 1)!;
  assert.ok(round1.requestedAt.getTime() >= state.nextAllowedAt.getTime());
  assert.ok(round1.requestedAt.getTime() >= start + 400_000);
});

test("a wait over one hour stops the reader and the other reader continues", async () => {
  const { store, bot, run } = harness();
  bot.readScript = [flood(3601)];
  const summary = await run();
  assert.equal(summary.stopReason, "completed");
  const state = await store.readerState("BOT_CHANNELS_GET_MESSAGES");
  assert.equal(state.stopReason, "flood_wait_over_one_hour");
  assert.equal(store.requests.filter((request) => request.reader === "BOT_CHANNELS_GET_MESSAGES" && request.purpose === "TRIAL_READ").length, 1);
  assert.equal(store.requests.filter((request) => request.reader === "USER_GET_MESSAGES_VIEWS" && request.purpose === "TRIAL_READ").length, 12);
});

test("the third flood wait inside 24 hours stops the reader", async () => {
  const { store, bot, run } = harness();
  bot.readScript = [flood(5), flood(5), flood(5)];
  await run();
  assert.equal((await store.readerState("BOT_CHANNELS_GET_MESSAGES")).stopReason, "third_flood_wait_in_24h");
  assert.equal(store.floodEvents.length, 3);
});

test("restart: a new runId, interrupted rows are abandoned, and stored waits still apply", async () => {
  const store = new MemoryLabStore();
  const clock = new FakeClock();
  const first = harness(store, clock);
  first.bot.readScript = [flood(1200)];
  first.clock.stopAfterSleeps = 4;
  const firstSummary = await first.run();
  assert.equal(firstSummary.stopReason, "signal");
  const channel = store.channels[0]!;
  await store.beginRequest(
    {
      runId: firstSummary.runId,
      reader: "USER_GET_MESSAGES_VIEWS",
      channelId: channel.id,
      idempotencyKey: "trial:r9:USER_GET_MESSAGES_VIEWS",
      source: "TELEGRAM",
      purpose: "TRIAL_READ",
      rpcMethod: "messages.GetMessagesViews",
      slotIndex: 9,
      retryOfId: null,
    },
    clock.now(),
  );
  store.runs[0]!.status = "RUNNING";

  const nextAllowedAt = (await store.readerState("BOT_CHANNELS_GET_MESSAGES")).nextAllowedAt!;
  clock.stopAfterSleeps = null;
  const second = harness(store, clock);
  const secondSummary = await second.run();
  assert.notEqual(secondSummary.runId, firstSummary.runId);
  assert.deepEqual(secondSummary.abandonedAtStart, { requests: 1, runs: 1, stoppedReaders: ["USER_GET_MESSAGES_VIEWS"] });
  assert.equal(store.requests.find((request) => request.idempotencyKey === "trial:r9:USER_GET_MESSAGES_VIEWS")?.status, "ABANDONED");
  assert.equal(
    store.requests.filter((request) => request.runId === secondSummary.runId && request.reader === "USER_GET_MESSAGES_VIEWS").length,
    0,
  );
  const secondBot = store.requests.filter(
    (request) => request.runId === secondSummary.runId && request.reader === "BOT_CHANNELS_GET_MESSAGES",
  );
  assert.ok(secondBot.length > 0);
  assert.ok(secondBot.every((request) => request.requestedAt.getTime() >= nextAllowedAt.getTime()));
  assert.ok(store.alerts.some((alert) => alert.runId === secondSummary.runId && alert.kind === "slot_skipped"));
});

test("a stopped reader is skipped on the next run until clear-stop", async () => {
  const { store, run, bot } = harness();
  await store.stopReader("BOT_CHANNELS_GET_MESSAGES", "AUTH_KEY_DUPLICATED", new Date());
  await run();
  assert.equal(bot.calls.length, 0);
  assert.ok(store.alerts.some((alert) => alert.kind === "reader_stopped_before_run"));
});

test("session errors stop the reader; channel errors stop the run", async () => {
  const reader = harness();
  reader.user.readScript = [{ error: new errors.AuthKeyDuplicatedError({ request: undefined } as never) }];
  await reader.run();
  assert.equal((await reader.store.readerState("USER_GET_MESSAGES_VIEWS")).stopReason, "AUTH_KEY_DUPLICATED");

  const channel = harness();
  channel.bot.readScript = [{ error: new errors.ChannelPrivateError({ request: undefined } as never) }];
  const summary = await channel.run();
  assert.equal(summary.stopReason, "error:CHANNEL_PRIVATE");
  assert.equal(channel.store.requests.filter((request) => request.purpose === "TRIAL_READ").length, 1);
});

test("SIGTERM during a wait stops before the next request", async () => {
  const { store, stop, run, clock } = harness();
  clock.stopAfterSleeps = 3;
  const summary = await run();
  assert.equal(summary.stopReason, "signal");
  stop.abort();
  assert.equal(store.runs[0]?.status, "STOPPED");
  assert.equal(await store.countStarted(), 0);
});

test("lock loss stops the worker and leaves the in-flight row STARTED", async () => {
  const { store, bot, lock, run } = harness();
  bot.readScript = [
    {
      run: async () => {
        lock.lose();
        return [{ messageId: 42, views: 1, resultKind: "MESSAGE" }];
      },
    },
  ];
  const summary = await run();
  assert.equal(summary.stopReason, "lock_lost");
  assert.equal(await store.countStarted(), 1);
  assert.equal(store.readings.length, 0);
});

test("preflight: one resolution and one read per reader, recorded as a PREFLIGHT run", async () => {
  const { store, run } = harness();
  const summary = await run("PREFLIGHT");
  assert.equal(summary.kind, "PREFLIGHT");
  assert.deepEqual(
    store.requests.map((request) => request.purpose).sort(),
    ["PEER_RESOLUTION", "PEER_RESOLUTION", "PREFLIGHT_READ", "PREFLIGHT_READ"],
  );
});

test("manual view event drives the renewal section of the report", async () => {
  const { store, run, user, bot, clock } = harness();
  bot.readScript = Array.from({ length: 12 }, (_, index) => ({ views: index < 6 ? 3 : 4 }));
  user.readScript = Array.from({ length: 12 }, (_, index) => ({ views: index < 6 ? 3 : 4 }));
  const startedAt = clock.time;
  await run();
  await store.addManualEvent({ runId: null, kind: "VIEW_OPENED", occurredAt: new Date(startedAt + 5.5 * 300_000), note: null });
  const report = buildLabReport({ trial: await store.loadRunReport(null, "TRIAL"), preflight: null, readerStates: [] });
  const renewal = report.trial?.counterRenewal;
  assert.equal(renewal?.status, "observed");
  if (renewal?.status === "observed") {
    assert.equal(renewal.byReader.BOT_CHANNELS_GET_MESSAGES.viewsBefore, 3);
    assert.equal(renewal.byReader.BOT_CHANNELS_GET_MESSAGES.firstViewsAfter, 4);
    assert.ok(renewal.byReader.USER_GET_MESSAGES_VIEWS.delayMs !== null);
  }
  assert.equal(report.trial?.differences.length, 12);
  assert.equal(report.trial?.botViewsVisible, true);
});

const keysOf = (store: MemoryLabStore, runId: string) =>
  store.requests.filter((request) => request.runId === runId).map((request) => request.idempotencyKey);
const skipped = (store: MemoryLabStore, runId: string) =>
  store.alerts.filter((alert) => alert.runId === runId && alert.kind === "slot_skipped").map((alert) => alert.detail);

test("a failed flood write stops the worker; the restart stops that reader before any new request", async () => {
  const store = new MemoryLabStore();
  const clock = new FakeClock();
  const first = harness(store, clock);
  first.bot.readScript = [flood(30)];
  store.failFloodWritesBeforeCommit = true;
  await assert.rejects(first.run(), (error: unknown) => error instanceof LabPersistenceError && error.stage === "fail");
  const firstRun = store.runs[0]!;
  assert.deepEqual(keysOf(store, firstRun.id), ["peer:BOT_CHANNELS_GET_MESSAGES:r0", "trial:r0:BOT_CHANNELS_GET_MESSAGES"]);
  assert.equal(store.requests[1]?.status, "STARTED");
  assert.equal(store.floodEvents.length, 0);

  const second = harness(store, clock);
  const summary = await second.run();
  assert.deepEqual(summary.abandonedAtStart.stoppedReaders, ["BOT_CHANNELS_GET_MESSAGES"]);
  assert.equal(store.requests[1]?.status, "ABANDONED");
  assert.equal((await store.readerState("BOT_CHANNELS_GET_MESSAGES")).stopReason, UNRESOLVED_STOP_REASON);
  assert.equal(second.bot.calls.length, 0);
  assert.ok(store.alerts.some((alert) => alert.runId === summary.runId && alert.kind === "reader_stopped_unresolved"));
  assert.equal(
    store.requests.filter((request) => request.runId === summary.runId && request.reader === "USER_GET_MESSAGES_VIEWS" && request.purpose === "TRIAL_READ").length,
    12,
  );
});

test("flood events from an earlier run count toward the stop limit after restart", async () => {
  const store = new MemoryLabStore();
  const clock = new FakeClock();
  const first = harness(store, clock, { rounds: 2, intervalMs: 300_000 });
  first.bot.readScript = [flood(5), flood(5)];
  await first.run();
  assert.equal(store.floodEvents.length, 2);
  assert.equal((await store.readerState("BOT_CHANNELS_GET_MESSAGES")).stoppedAt, null);

  const second = harness(store, clock, { rounds: 2, intervalMs: 300_000 });
  second.bot.readScript = [flood(5)];
  const summary = await second.run();
  assert.equal((await store.readerState("BOT_CHANNELS_GET_MESSAGES")).stopReason, "third_flood_wait_in_24h");
  const botReads = store.requests.filter(
    (request) => request.runId === summary.runId && request.reader === "BOT_CHANNELS_GET_MESSAGES" && request.purpose === "TRIAL_READ",
  );
  assert.equal(botReads.length, 1);
});

test("a late wake-up past the round deadline records slot_skipped and sends nothing for that round", async () => {
  const { store, clock, run } = harness();
  const start = clock.time;
  clock.nextWakeJumpMs = 400_000;
  const summary = await run();
  assert.ok(skipped(store, summary.runId).includes("trial:r0:BOT_CHANNELS_GET_MESSAGES deadline"));
  assert.ok(skipped(store, summary.runId).includes("peer:USER_GET_MESSAGES_VIEWS:r0 deadline"));
  assert.equal(store.requests.some((request) => request.purpose === "TRIAL_READ" && request.slotIndex === 0), false);
  for (const request of store.requests) {
    const round = request.slotIndex ?? 0;
    assert.ok(request.requestedAt.getTime() < start + (round + 1) * 300_000, request.idempotencyKey);
  }
  assert.equal(store.requests.filter((request) => request.purpose === "TRIAL_READ" && request.slotIndex === 1).length, 2);
});

test("a time jump during a request skips every ended round without a backlog", async () => {
  const { store, clock, bot, run } = harness();
  const start = clock.time;
  bot.readScript = [
    {
      run: async () => {
        clock.advance(10 * 300_000);
        return [{ messageId: 42, views: 1, resultKind: "MESSAGE" }];
      },
    },
  ];
  const summary = await run();
  const reads = store.requests.filter((request) => request.runId === summary.runId && request.purpose === "TRIAL_READ");
  assert.deepEqual(
    [...new Set(reads.map((request) => request.slotIndex))].sort((a, b) => a! - b!),
    [0, 10, 11],
  );
  for (const request of reads) {
    assert.ok(request.requestedAt.getTime() < start + (request.slotIndex! + 1) * 300_000, request.idempotencyKey);
  }
  for (let round = 1; round <= 9; round += 1) {
    assert.ok(skipped(store, summary.runId).includes(`trial:r${round}:BOT_CHANNELS_GET_MESSAGES deadline`), `round ${round}`);
  }
});

test("a request that runs past the next round skips that round's peer resolution, reads, and retry", async () => {
  const { store, bot, user, run } = harness(new MemoryLabStore(), new FakeClock(), { rounds: 3, intervalMs: 300_000 });
  bot.readScript = [
    {
      run: async () => {
        bot.latencyMs = 200;
        return [{ messageId: 42, views: 1, resultKind: "MESSAGE" }];
      },
    },
  ];
  bot.latencyMs = 650_000;
  user.readScript = [];
  const summary = await run();
  const keys = keysOf(store, summary.runId);
  assert.equal(keys.includes("peer:USER_GET_MESSAGES_VIEWS:r0"), false);
  assert.equal(keys.includes("trial:r1:BOT_CHANNELS_GET_MESSAGES"), false);
  assert.equal(keys.includes("trial:r1:USER_GET_MESSAGES_VIEWS"), false);
  assert.ok(skipped(store, summary.runId).includes("peer:USER_GET_MESSAGES_VIEWS:r0 deadline"));
  assert.ok(keys.includes("trial:r2:BOT_CHANNELS_GET_MESSAGES"));

  const retry = harness(new MemoryLabStore(), new FakeClock(), { rounds: 1, intervalMs: 300_000 });
  retry.bot.latencyMs = 280_000;
  retry.bot.readScript = [timeout()];
  const retrySummary = await retry.run();
  assert.equal(keysOf(retry.store, retrySummary.runId).includes("trial:r0:BOT_CHANNELS_GET_MESSAGES:retry1"), false);
  assert.ok(skipped(retry.store, retrySummary.runId).some((detail) => detail.startsWith("trial:r0:BOT_CHANNELS_GET_MESSAGES:retry1 ")));
});
