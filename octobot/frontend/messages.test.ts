import assert from "node:assert/strict";
import test from "node:test";
import ar from "./messages/ar.json" with { type: "json" };
import en from "./messages/en.json" with { type: "json" };

function keysOf(value: unknown, prefix = ""): string[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return [prefix];
  }
  return Object.entries(value).flatMap(([key, entry]) =>
    keysOf(entry, prefix ? `${prefix}.${key}` : key),
  );
}

test("Arabic and English admin catalogs have the same keys", () => {
  assert.deepEqual(keysOf(ar).sort(), keysOf(en).sort());
});
