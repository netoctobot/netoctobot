import assert from "node:assert/strict";
import test from "node:test";
import { buildChannelAddLink } from "./channel-add-link.js";

test("builds the official channel admin deep link", () => {
  assert.equal(
    buildChannelAddLink("@example_bot"),
    "https://t.me/example_bot?startchannel&admin=post_messages+edit_messages+delete_messages+invite_users",
  );
});

test("rejects invalid bot usernames", () => {
  assert.throws(() => buildChannelAddLink("bad username"));
});
