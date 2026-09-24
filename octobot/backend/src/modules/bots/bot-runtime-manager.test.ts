import assert from "node:assert/strict";
import test from "node:test";
import {
  deriveWebhookSecret,
  isBotTokenFormatValid,
} from "./bot-runtime-manager.js";

test("validates Telegram bot token shape without logging the token", () => {
  assert.equal(
    isBotTokenFormatValid(
      "1234567890:abcdefghijklmnopqrstuvwxyzABCDE_12345",
    ),
    true,
  );
  assert.equal(isBotTokenFormatValid("not-a-token"), false);
});

test("derives stable bot-specific webhook secrets", () => {
  const first = deriveWebhookSecret("master-secret", "bot-a");
  const repeated = deriveWebhookSecret("master-secret", "bot-a");
  const otherBot = deriveWebhookSecret("master-secret", "bot-b");

  assert.equal(first, repeated);
  assert.notEqual(first, otherBot);
  assert.match(first, /^[a-f0-9]{64}$/);
});
