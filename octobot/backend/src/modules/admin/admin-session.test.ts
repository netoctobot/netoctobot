import assert from "node:assert/strict";
import test from "node:test";
import {
  readAdminSession,
  readCookie,
  signAdminSession,
} from "./admin-session.js";

const secret = "00".repeat(32);

test("round-trips an admin session and rejects tampering", () => {
  const token = signAdminSession(
    { userId: "user_1", telegramId: "123", exp: 1_800_000_000 },
    secret,
  );
  assert.deepEqual(readAdminSession(token, secret, 1_700_000_000_000), {
    userId: "user_1",
    telegramId: "123",
    exp: 1_800_000_000,
  });
  assert.equal(
    readAdminSession(`${token}x`, secret, 1_700_000_000_000),
    null,
  );
  assert.equal(readAdminSession(token, secret, 1_800_000_000_000), null);
});

test("reads one named cookie", () => {
  assert.equal(
    readCookie("a=1; octobot_admin_session=abc%3D; b=2", "octobot_admin_session"),
    "abc=",
  );
});
