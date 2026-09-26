import assert from "node:assert/strict";
import test from "node:test";
import { loadEnv } from "./env.js";

const validEnv: NodeJS.ProcessEnv = {
  DATABASE_URL: "postgresql://octobot:octobot@localhost:5432/octobot",
  REDIS_URL: "redis://localhost:6379",
  BOT_TOKEN: "test-token",
  OWNER_TELEGRAM_ID: "123456789",
  ENCRYPTION_KEY: "00".repeat(32),
  WEBHOOK_SECRET: "valid_test-secret",
  PUBLIC_BASE_URL: "http://localhost:3000",
  WEBHOOK_REGISTRATION_ENABLED: "false",
  PORT: "3000",
};

test("loads typed environment values", () => {
  const env = loadEnv(validEnv);

  assert.equal(env.OWNER_TELEGRAM_ID, 123456789n);
  assert.equal(env.WEBHOOK_REGISTRATION_ENABLED, false);
  assert.equal(env.PORT, 3000);
});

test("requires HTTPS when webhook registration is enabled", () => {
  assert.throws(() =>
    loadEnv({
      ...validEnv,
      WEBHOOK_REGISTRATION_ENABLED: "true",
    }),
  );
});
