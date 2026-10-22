import assert from "node:assert/strict";
import test from "node:test";
import { decryptLabSession, encryptLabSession, LabKeyConflictError } from "./session-crypto.js";

const applicationKey = "11".repeat(32);
const labKey = "22".repeat(32);

test("lab sessions use an independent key and the current cipher", () => {
  const session = "session-string-not-for-logs";
  const ciphertext = encryptLabSession(session, labKey, applicationKey);

  assert.equal(ciphertext.includes(session), false);
  assert.equal(ciphertext.startsWith("v1."), true);
  assert.equal(decryptLabSession(ciphertext, labKey, applicationKey), session);
  assert.throws(() => decryptLabSession(ciphertext, applicationKey, labKey));
});

test("the lab key is rejected when it matches the application key", () => {
  assert.throws(
    () => encryptLabSession("session", applicationKey, applicationKey.toUpperCase()),
    LabKeyConflictError,
  );
});
