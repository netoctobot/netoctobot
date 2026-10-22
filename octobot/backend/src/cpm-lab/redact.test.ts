import assert from "node:assert/strict";
import test from "node:test";
import { createRedactingLogger, redactError, redactSecrets } from "./redact.js";

const session = "lab-session-1:this-is-a-long-session-secret";
const apiHash = "abcdef1234567890abcdef1234567890";

test("redactSecrets removes supplied secrets and bot tokens", () => {
  const token = "123456789:abcdefghijklmnopqrstuvwxyz";
  const text = `hash=${apiHash} session ${session} token ${token} LAB_API_HASH=${apiHash}`;
  const redacted = redactSecrets(text, [session, apiHash]);

  assert.equal(redacted.includes(session), false);
  assert.equal(redacted.includes(apiHash), false);
  assert.equal(redacted.includes(token), false);
  assert.match(redacted, /LAB_API_HASH=\[redacted\]/);
});

test("error reports are redacted before they are emitted", () => {
  const lines: string[] = [];
  const logger = createRedactingLogger([session], (line) => lines.push(line));
  logger.logError(new Error(`failed while saving ${session}`));

  assert.equal(lines.length, 1);
  assert.equal(lines[0]?.includes(session), false);
  assert.match(lines[0] ?? "", /\[redacted\]/);
  assert.equal(redactError(new Error(session), [session]).includes(session), false);
});
