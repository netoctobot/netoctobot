import assert from "node:assert/strict";
import test from "node:test";
import { buildDeliveryCreatesFromPreview } from "./service.js";

test("buildDeliveryCreatesFromPreview merges channel and user rows", () => {
  const creates = buildDeliveryCreatesFromPreview("CHANNELS_AND_USERS", {
    eligible: [
      {
        kind: "channel",
        channelId: "c1",
        title: "C",
        username: null,
        botId: "b1",
      },
      {
        kind: "user",
        userId: "u1",
        displayName: "U",
        username: null,
        botId: "b1",
        senderBotId: "b1",
      },
    ],
    excluded: [],
  });
  assert.equal(creates.length, 2);
  assert.ok(creates.some((row) => "channelId" in row && row.channelId === "c1"));
  assert.ok(creates.some((row) => "userId" in row && row.userId === "u1"));
});
