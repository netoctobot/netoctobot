import assert from "node:assert/strict";
import test from "node:test";
import { decryptToken, encryptToken } from "./token-crypto.js";

const key = "0123456789abcdef".repeat(4);

test("encryptToken round-trips without exposing plaintext", () => {
  const token = "123456:telegram-secret-token";
  const encrypted = encryptToken(token, key);

  assert.notEqual(encrypted, token);
  assert.equal(encrypted.startsWith("v1."), true);
  assert.equal(decryptToken(encrypted, key), token);
});

test("decryptToken rejects tampered ciphertext", () => {
  const encrypted = encryptToken("secret", key);
  const replacement = encrypted.endsWith("A") ? "B" : "A";
  const tampered = `${encrypted.slice(0, -1)}${replacement}`;

  assert.throws(() => decryptToken(tampered, key));
});
