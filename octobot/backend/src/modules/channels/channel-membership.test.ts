import assert from "node:assert/strict";
import test from "node:test";
import type { ChatMember } from "grammy/types";
import { classifyChannelMembership } from "./channel-membership.js";

function membership(value: Partial<ChatMember>): ChatMember {
  return value as ChatMember;
}

test("classifies valid channel administrator rights", () => {
  assert.equal(
    classifyChannelMembership(
      membership({
        status: "administrator",
        can_post_messages: true,
        can_delete_messages: true,
      }),
    ),
    "VALID",
  );
});

test("classifies missing required rights separately from removal", () => {
  assert.equal(
    classifyChannelMembership(
      membership({
        status: "administrator",
        can_post_messages: true,
        can_delete_messages: false,
      }),
    ),
    "PERMISSIONS_LOST",
  );
  assert.equal(
    classifyChannelMembership(membership({ status: "left" })),
    "BOT_REMOVED",
  );
  assert.equal(
    classifyChannelMembership(membership({ status: "kicked" })),
    "BOT_REMOVED",
  );
});
