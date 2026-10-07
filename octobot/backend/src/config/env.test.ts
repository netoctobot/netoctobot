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

test("requires both local admin variables outside production", () => {
  const withAdmin = loadEnv({
    ...validEnv,
    LOCAL_ADMIN_USERNAME: "localadmin",
    LOCAL_ADMIN_PASSWORD: "local-password",
  });
  assert.equal(withAdmin.LOCAL_ADMIN_USERNAME, "localadmin");
  assert.equal(withAdmin.NODE_ENV, undefined);

  assert.throws(() =>
    loadEnv({
      ...validEnv,
      LOCAL_ADMIN_USERNAME: "localadmin",
    }),
  );

  const production = loadEnv({
    ...validEnv,
    NODE_ENV: "production",
    LOCAL_ADMIN_USERNAME: "localadmin",
  });
  assert.equal(production.NODE_ENV, "production");
  assert.equal(production.LOCAL_ADMIN_USERNAME, "localadmin");
  assert.equal(production.LOCAL_ADMIN_PASSWORD, undefined);
});

test("requires HTTPS when webhook registration is enabled", () => {
  assert.throws(() =>
    loadEnv({
      ...validEnv,
      WEBHOOK_REGISTRATION_ENABLED: "true",
    }),
  );
});
