import assert from "node:assert/strict";
import test from "node:test";
import {
  resolveChannelChatReference,
  type ChannelReferenceMessage,
} from "./channel-reference.js";

function message(
  value: Record<string, unknown>,
): ChannelReferenceMessage {
  return value as unknown as ChannelReferenceMessage;
}

test("uses Telegram channel origin instead of forwarded text", () => {
  assert.equal(
    resolveChannelChatReference(
      message({
        text: "@unrelated_channel",
        forward_origin: {
          type: "channel",
          chat: {
            id: -1001234567890,
            type: "channel",
            title: "Source",
          },
          message_id: 1,
          date: 1,
        },
      }),
    ),
    -1001234567890,
  );
});

test("rejects non-channel forwards even when their text is a username", () => {
  assert.equal(
    resolveChannelChatReference(
      message({
        text: "@channel_name",
        forward_origin: {
          type: "user",
          sender_user: { id: 123, is_bot: false, first_name: "User" },
          date: 1,
        },
      }),
    ),
    null,
  );
});

test("accepts one complete public channel reference", () => {
  assert.equal(
    resolveChannelChatReference(message({ text: "@channel_name" })),
    "@channel_name",
  );
  assert.equal(
    resolveChannelChatReference(message({ text: "channel_name" })),
    "@channel_name",
  );
  assert.equal(
    resolveChannelChatReference({
      text: "https://t.me/channel_name",
    }),
    "@channel_name",
  );
  assert.equal(
    resolveChannelChatReference({ text: "-1001234567890" }),
    -1001234567890,
  );
});

test("rejects mixed text, multiple references, and invite links", () => {
  for (const text of [
    "channel @channel_name",
    "@channel_name @other_channel",
    "https://t.me/+privateInvite",
    "https://t.me/channel_name/42",
    "@four",
    "@channel_name\n@other_channel",
  ]) {
    assert.equal(resolveChannelChatReference({ text }), null);
  }
});
