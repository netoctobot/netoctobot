import assert from "node:assert/strict";
import test from "node:test";
import { normalizeAdminReason } from "./reason.ts";

test("reason validation matches the 200 character limit", () => {
  assert.equal(normalizeAdminReason("  too   many spaces "), "too many spaces");
  assert.equal(normalizeAdminReason(" "), null);
});
