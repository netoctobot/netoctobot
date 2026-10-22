import assert from "node:assert/strict";
import test from "node:test";
import { ReadingLog } from "./reading-log.js";

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
