import assert from "node:assert/strict";
import test from "node:test";
import {
  parseTelegramLoginBody,
  verifyTelegramLogin,
  type TelegramLoginData,
} from "./telegram-login.js";

const token = "test-token";
const nowMs = 1_700_000_000_000 + 5_000;

const valid: TelegramLoginData = {
  id: "123456789",
  first_name: "Owner",
  auth_date: "1700000000",
  hash: "446b7292f75b2f68995f9a146626d0e4b4a690b6137b7512cca49bae583c43ab",
};

test("accepts a Telegram login signed with the bot token", () => {
  assert.equal(verifyTelegramLogin(valid, token, nowMs), true);
});

test("rejects a tampered or stale login", () => {
  assert.equal(
    verifyTelegramLogin({ ...valid, id: "123456780" }, token, nowMs),
    false,
  );
  assert.equal(
    verifyTelegramLogin(valid, token, nowMs + 86_400_000),
    false,
  );
});

test("parses widget numbers and ignores blank optional fields", () => {
  const parsed = parseTelegramLoginBody({
    id: 123456789,
    first_name: "Owner",
    last_name: " ",
    auth_date: 1700000000,
    hash: valid.hash.toUpperCase(),
  });
  assert.deepEqual(parsed, valid);
});
