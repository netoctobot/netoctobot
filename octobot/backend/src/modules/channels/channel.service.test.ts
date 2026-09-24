import assert from "node:assert/strict";
import test from "node:test";
import type { ChatMember } from "grammy/types";
import { hasRequiredChannelRights } from "./channel.service.js";

function membership(value: Partial<ChatMember>): ChatMember {
  return value as ChatMember;
}

test("requires post and delete rights but not edit or invite rights", () => {
  assert.equal(
    hasRequiredChannelRights(
      membership({
        status: "administrator",
        can_post_messages: true,
        can_delete_messages: true,
        can_edit_messages: false,
        can_invite_users: false,
      }),
    ),
    true,
  );
  assert.equal(
    hasRequiredChannelRights(
      membership({
        status: "administrator",
        can_post_messages: true,
        can_delete_messages: false,
      }),
    ),
    false,
  );
});
