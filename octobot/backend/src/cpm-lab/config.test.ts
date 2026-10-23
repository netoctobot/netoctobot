import assert from "node:assert/strict";
import test from "node:test";
import { channelConfig, labSecrets, LabConfigError, parseInviteHash, sessionKey, telegramCredentials, trialConfig } from "./config.js";
import { assertIsolatedTestDatabase, LabTestDatabaseError, withSchema } from "./lab-test-database.js";

test("config errors name the variable without its value", () => {
  const hash = "zz-not-a-hash-value";
  assert.throws(
    () => telegramCredentials({ LAB_API_ID: "1", LAB_API_HASH: hash }),
    (error: Error) => error instanceof LabConfigError && error.message.includes("LAB_API_HASH") && !error.message.includes(hash),
  );
  assert.throws(() => sessionKey({ LAB_SESSION_ENCRYPTION_KEY: "abc" }), /64 hex/);
});

test("channel id accepts the -100 form, and one post id is required", () => {
  const config = channelConfig({ LAB_CHANNEL_ID: "-1001234567890", LAB_POST_ID: "42", LAB_CHANNEL_INVITE_LINK: "https://t.me/+AbCdEfGh12" });
  assert.equal(config.telegramChannelId, 1234567890n);
  assert.equal(config.inviteHash, "AbCdEfGh12");
  assert.throws(() => channelConfig({ LAB_CHANNEL_ID: "-1001", LAB_POST_ID: "1,2" }), /LAB_POST_ID/);
  assert.equal(parseInviteHash("t.me/joinchat/AbCdEfGh12"), "AbCdEfGh12");
});

test("trial defaults to 12 rounds every 5 minutes, bounded by fixed limits", () => {
  assert.deepEqual(trialConfig({}), { rounds: 12, intervalMs: 300_000 });
  assert.throws(() => trialConfig({ LAB_TRIAL_ROUNDS: "25" }), /between 1 and 24/);
  assert.throws(() => trialConfig({ LAB_TRIAL_INTERVAL_SECONDS: "10" }), /between 60 and 3600/);
});

test("lab secrets include URL passwords", () => {
  const secrets = labSecrets({ LAB_DATABASE_URL: "postgresql://lab:p%40ss-word-1@lab-postgres:5432/cpm_lab" });
  assert.ok(secrets.includes("p@ss-word-1"));
});

test("LAB_TEST_DATABASE_URL must be distinct from the lab and application databases", () => {
  const lab = "postgresql://lab:x@lab-postgres:5432/cpm_lab";
  const testUrl = "postgresql://lab:x@lab-postgres:5432/cpm_lab_test";
  assert.equal(assertIsolatedTestDatabase({ LAB_TEST_DATABASE_URL: testUrl, LAB_DATABASE_URL: lab, DATABASE_URL: "postgresql://postgres:5432/octobot" }), testUrl);
  assert.throws(() => assertIsolatedTestDatabase({}), LabTestDatabaseError);
  assert.throws(() => assertIsolatedTestDatabase({ LAB_TEST_DATABASE_URL: lab.replace("lab:x", "other:y"), LAB_DATABASE_URL: lab }), /LAB_DATABASE_URL/);
  assert.throws(
    () => assertIsolatedTestDatabase({ LAB_TEST_DATABASE_URL: "postgresql://a@postgres/octobot", DATABASE_URL: "postgresql://b@POSTGRES:5432/octobot" }),
    (error: Error) => /DATABASE_URL/.test(error.message) && !error.message.includes("postgres:"),
  );
  assert.equal(new URL(withSchema(testUrl, "cpm_lab_test_0123456789ab")).searchParams.get("schema"), "cpm_lab_test_0123456789ab");
});
