import assert from "node:assert/strict";
import test from "node:test";
import { ReadingLog, RequestIdentityConflictError } from "./reading-log.js";

const messages = [
  { messageId: "11", views: 4 },
  { messageId: "12", views: 9 },
  { messageId: "11", views: 4 },
  { messageId: "13", views: 2 },
];

test("one RPC result stores several readings and a repeat does not change them", () => {
  const log = new ReadingLog();
  const input = {
    runId: "run-1",
    reader: "BOT_CHANNELS_GET_MESSAGES" as const,
    channelId: "channel-a",
    idempotencyKey: "request-7",
    source: "INJECTED" as const,
    messages,
  };
  const first = log.saveResult(input);
  const second = log.saveResult({
    ...input,
    messages: [
      { messageId: "11", views: 100 },
      { messageId: "12", views: 100 },
      { messageId: "13", views: 100 },
    ],
  });

  assert.equal(log.requests.length, 1);
  assert.equal(log.requests[0]?.reader, "BOT_CHANNELS_GET_MESSAGES");
  assert.equal(log.requests[0]?.runId, "run-1");
  assert.equal(first.inserted, 3);
  assert.equal(first.readingCount, 3);
  assert.equal(second.inserted, 0);
  assert.equal(second.alreadyStored, true);
  assert.equal(second.readingCount, 3);
  assert.equal(second.unchanged, false);
  assert.deepEqual(first.differences, []);
  assert.deepEqual(second.differences, [
    { messageId: "11", storedViews: 4, incomingViews: 100 },
    { messageId: "12", storedViews: 9, incomingViews: 100 },
    { messageId: "13", storedViews: 2, incomingViews: 100 },
  ]);
  assert.equal(log.readings.length, 3);
  assert.deepEqual(
    log.readings.map((reading) => reading.views),
    [4, 9, 2],
  );
  assert.deepEqual(
    log.readings.map((reading) => `${reading.requestId}:${reading.channelId}:${reading.messageId}`),
    ["rpc-1:channel-a:11", "rpc-1:channel-a:12", "rpc-1:channel-a:13"],
  );
});

test("the same request with the same views reports no differences", () => {
  const log = new ReadingLog();
  const input = {
    runId: "run-1",
    reader: "BOT_CHANNELS_GET_MESSAGES" as const,
    channelId: "channel-a",
    idempotencyKey: "request-7",
    source: "INJECTED" as const,
    errorClass: "TIMEOUT",
    messages,
  };
  log.saveResult(input);
  const repeat = log.saveResult({
    ...input,
    errorClass: "NETWORK",
    messages: [...messages],
  });

  assert.equal(repeat.unchanged, true);
  assert.deepEqual(repeat.differences, []);
  assert.equal(log.requests.length, 1);
  assert.equal(log.readings.length, 3);
  assert.equal(log.requests[0]?.errorClass, "TIMEOUT");
});

test("a changed message set keeps the first views and lists absent sides", () => {
  const log = new ReadingLog();
  const input = {
    runId: "run-1",
    reader: "BOT_CHANNELS_GET_MESSAGES" as const,
    channelId: "channel-a",
    idempotencyKey: "request-7",
    source: "INJECTED" as const,
    messages,
  };
  log.saveResult(input);
  const repeat = log.saveResult({
    ...input,
    messages: [
      { messageId: "11", views: 4 },
      { messageId: "14", views: 7 },
    ],
  });

  assert.equal(repeat.unchanged, false);
  assert.deepEqual(repeat.differences, [
    { messageId: "12", storedViews: 9, incomingViews: "absent" },
    { messageId: "13", storedViews: 2, incomingViews: "absent" },
    { messageId: "14", storedViews: "absent", incomingViews: 7 },
  ]);
  assert.deepEqual(
    log.readings.map((reading) => reading.views),
    [4, 9, 2],
  );
});

test("a reused key with another channel, reader, or source is rejected", () => {
  const stored = {
    runId: "run-1",
    reader: "BOT_CHANNELS_GET_MESSAGES" as const,
    channelId: "channel-a",
    idempotencyKey: "request-7",
    source: "INJECTED" as const,
    messages,
  };
  const conflicts = [
    { field: "channelId" as const, patch: { channelId: "channel-b" } },
    { field: "reader" as const, patch: { reader: "USER_GET_MESSAGES_VIEWS" as const } },
    { field: "source" as const, patch: { source: "TELEGRAM" as const } },
  ];

  for (const conflict of conflicts) {
    const log = new ReadingLog();
    log.saveResult(stored);
    assert.throws(
      () => log.saveResult({ ...stored, ...conflict.patch }),
      (error: unknown) => {
        assert.ok(error instanceof RequestIdentityConflictError);
        assert.equal(error.field, conflict.field);
        assert.equal(error.message.includes("request-7"), false);
        return true;
      },
    );
    assert.equal(log.requests.length, 1);
    assert.equal(log.readings.length, 3);
    assert.deepEqual(
      log.readings.map((reading) => reading.views),
      [4, 9, 2],
    );
  }
});

test("matching message ids and views still conflict when the request identity differs", () => {
  const log = new ReadingLog();
  log.saveResult({
    runId: "run-1",
    reader: "BOT_CHANNELS_GET_MESSAGES",
    channelId: "channel-a",
    idempotencyKey: "request-7",
    source: "INJECTED",
    messages,
  });

  assert.throws(
    () =>
      log.saveResult({
        runId: "run-1",
        reader: "USER_GET_MESSAGES_VIEWS",
        channelId: "channel-b",
        idempotencyKey: "request-7",
        source: "TELEGRAM",
        messages,
      }),
    (error: unknown) => {
      assert.ok(error instanceof RequestIdentityConflictError);
      assert.equal(error.field, "channelId");
      return true;
    },
  );
  assert.equal(log.requests.length, 1);
  assert.equal(log.readings.length, 3);
});
