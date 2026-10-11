import assert from "node:assert/strict";
import test from "node:test";
import {
  assignPreliminaryUserSenders,
  assignSenders,
  classifySendError,
  collectBroadcastChannels,
  collectBroadcastOwners,
  collectBroadcastUsers,
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
  assert.equal(
    classifySendError({ error_code: 403, description: "Forbidden: bot was blocked by the user" }).action,
    "failed",
  );
  assert.equal(
    classifySendError({ error_code: 403, description: "Forbidden: bot was blocked by the user" }).reason,
    "user_blocked",
  );
  assert.equal(classifySendError({ error_code: 429, parameters: { retry_after: 2 } }).action, "retry");
});

test("bot users are deduplicated and pick the most recent private sender bot", () => {
  const established = new Date("2026-02-01T10:00:00Z");
  const newer = new Date("2026-02-02T10:00:00Z");
  const collected = collectBroadcastUsers({
    bots: [
      { id: "bot-a", ownerId: "owner-1", botUsername: "a", isActive: true, deletedAt: null },
      { id: "bot-b", ownerId: "owner-2", botUsername: "b", isActive: true, deletedAt: null },
    ],
    selectedIds: null,
    scope: { includeActive: true, includeInactive: false, includeDeleted: false },
    includeBotOwners: true,
    users: [
      {
        userId: "user-1",
        telegramId: "100",
        username: "u1",
        firstName: "One",
        lastName: null,
        deletedAt: null,
      },
    ],
    preferences: [
      {
        userId: "user-1",
        botId: "bot-a",
        privateChatEstablishedAt: established,
        lastPrivateInteractionAt: established,
      },
      {
        userId: "user-1",
        botId: "bot-b",
        privateChatEstablishedAt: established,
        lastPrivateInteractionAt: newer,
      },
    ],
  });
  assert.equal(collected.included.length, 1);
  assert.equal(collected.included[0]?.botId, "bot-b");
});

test("bot users can exclude bot owners", () => {
  const established = new Date("2026-02-01T10:00:00Z");
  const collected = collectBroadcastUsers({
    bots: [{ id: "bot-a", ownerId: "owner-1", botUsername: "a", isActive: true, deletedAt: null }],
    selectedIds: null,
    scope: { includeActive: true, includeInactive: false, includeDeleted: false },
    includeBotOwners: false,
    users: [
      {
        userId: "owner-1",
        telegramId: "200",
        username: "owner",
        firstName: "Owner",
        lastName: null,
        deletedAt: null,
      },
    ],
    preferences: [
      {
        userId: "owner-1",
        botId: "bot-a",
        privateChatEstablishedAt: established,
        lastPrivateInteractionAt: established,
      },
    ],
  });
  assert.equal(collected.included.length, 0);
  assert.deepEqual(collected.excluded.map((row) => row.reason), ["owner_excluded"]);
});

test("bot owners are deduplicated and prefer the platform bot sender", () => {
  const established = new Date("2026-02-01T10:00:00Z");
  const collected = collectBroadcastOwners({
    bots: [
      { id: "bot-a", ownerId: "owner-1", botUsername: "a", isActive: true, deletedAt: null },
      { id: "bot-b", ownerId: "owner-1", botUsername: "b", isActive: true, deletedAt: null },
    ],
    selectedIds: null,
    scope: { includeActive: true, includeInactive: false, includeDeleted: false },
    platformBotId: "platform",
    users: [
      {
        userId: "owner-1",
        telegramId: "300",
        username: "owner",
        firstName: "Owner",
        lastName: null,
        deletedAt: null,
      },
    ],
    preferences: [
      {
        userId: "owner-1",
        botId: "platform",
        privateChatEstablishedAt: established,
        lastPrivateInteractionAt: established,
      },
      {
        userId: "owner-1",
        botId: "bot-a",
        privateChatEstablishedAt: established,
        lastPrivateInteractionAt: established,
      },
    ],
  });
  assert.equal(collected.included.length, 1);
  assert.equal(collected.included[0]?.botId, "platform");
});

test("preliminary user senders require a valid token only", () => {
  const assigned = assignPreliminaryUserSenders(
    [
      {
        userId: "user-1",
        username: "u1",
        displayName: "One",
        telegramId: "1",
        botId: "bot-a",
        candidateBotIds: ["bot-a"],
      },
    ],
    (botId) => botId === "bot-a",
  );
  assert.equal(assigned.eligible.length, 1);
  assert.deepEqual(
    assignPreliminaryUserSenders(
      [
        {
          userId: "user-2",
          username: "u2",
          displayName: "Two",
          telegramId: "2",
          botId: "bot-b",
          candidateBotIds: ["bot-b"],
        },
      ],
      () => false,
    ).excluded.map((row) => row.reason),
    ["invalid_token"],
  );
});
