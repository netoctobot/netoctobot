import assert from "node:assert/strict";
import test from "node:test";
import { ADMIN_REASON_LIMIT } from "../support-list/constants.js";
import { normalizeAdminReason } from "./admin-reason.js";

test("collapses whitespace and keeps the support-list reason limit", () => {
  assert.equal(normalizeAdminReason("  spam   list  "), "spam list");
  assert.equal(normalizeAdminReason("   "), null);
  assert.equal(normalizeAdminReason("x".repeat(ADMIN_REASON_LIMIT + 1)), null);
});
