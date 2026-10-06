import assert from "node:assert/strict";
import test from "node:test";
import { appointmentParts, formatNumber } from "./format.ts";

test("numbers follow the active language", () => {
  assert.equal(formatNumber("en", 1234), new Intl.NumberFormat("en").format(1234));
  assert.equal(formatNumber("ar", 1234), new Intl.NumberFormat("ar").format(1234));
});

test("appointments keep the stored time zone visible", () => {
  const iso = "2026-01-15T00:30:00.000Z";
  const utc = appointmentParts("en", iso, "UTC");
  const riyadh = appointmentParts("en", iso, "Asia/Riyadh");
  assert.notEqual(utc.when, riyadh.when);
  assert.equal(riyadh.timeZone, "Asia/Riyadh");
  assert.notEqual(
    appointmentParts("ar", iso, "Asia/Riyadh").when,
    appointmentParts("en", iso, "UTC").when,
  );
});
