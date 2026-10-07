import assert from "node:assert/strict";
import test from "node:test";
import {
  assignSenders,
  classifySendError,
  collectBroadcastChannels,
  nextDelivery,
} from "./plan.js";

const channels = [
  { id: "shared", title: "Shared", username: "shared", telegramId: "1", deletedAt: null },
  { id: "listed", title: "Listed", username: null, telegramId: "2", deletedAt: null },
  { id: "old", title: "Old", username: "old", telegramId: "3", deletedAt: new Date("2026-01-01") },
  { id: "paused", title: "Paused", username: "paused", telegramId: "4", deletedAt: null },
];

test("broadcast channels come from links and support-list memberships once", async () => {
  const collected = collectBroadcastChannels({
    bots: [
      { id: "active", isActive: true, deletedAt: null },
      { id: "support", isActive: true, deletedAt: null },
      { id: "inactive", isActive: false, deletedAt: null },
    ],
    selectedIds: null,
    scope: { includeActive: true, includeInactive: false, includeDeleted: false },
    links: [
      { botId: "active", channelId: "shared" },
      { botId: "support", channelId: "shared" },
      { botId: "inactive", channelId: "paused" },
    ],
    memberships: [
      { botId: "support", channelId: "listed", deletedAt: null },
      { botId: "support", channelId: "old", deletedAt: new Date("2026-01-02") },
    ],
    channels,
  });
  assert.deepEqual(
    collected.included.map((channel) => channel.channelId),
    ["listed", "shared"],
  );
  assert.deepEqual(collected.included.find((channel) => channel.channelId === "shared")?.botIds, [
    "active",
    "support",
  ]);
  assert.deepEqual(collected.excluded.map((channel) => channel.reason), ["deleted", "bot_out_of_scope"]);
  const assigned = await assignSenders(collected.included, async (botId) =>
    botId === "support" ? { ok: true } : { ok: false, reason: "invalid_token" },
  );
  assert.deepEqual(
    assigned.eligible.map((channel) => [channel.channelId, channel.botId]),
    [
      ["listed", "support"],
      ["shared", "support"],
    ],
  );
});

test("a successful or uncertain broadcast delivery is not sent again", () => {
  assert.deepEqual(nextDelivery("SENT", false), { send: false, status: "SENT" });
  assert.deepEqual(nextDelivery("UNCERTAIN", false), { send: false, status: "UNCERTAIN" });
  assert.deepEqual(nextDelivery("PENDING", true), { send: false, status: "STOPPED" });
  assert.equal(classifySendError(new Error("timed out")).action, "uncertain");
  assert.equal(classifySendError({ error_code: 403, description: "forbidden" }).action, "failed");
  assert.equal(classifySendError({ error_code: 429, parameters: { retry_after: 2 } }).action, "retry");
});
