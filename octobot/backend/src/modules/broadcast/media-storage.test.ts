import assert from "node:assert/strict";
import test from "node:test";
import { sanitizeBroadcastFilename } from "./media-storage.js";

test("sanitizeBroadcastFilename keeps xlsx pdf and zip extensions", () => {
  assert.equal(sanitizeBroadcastFilename("report.xlsx"), "report.xlsx");
  assert.equal(sanitizeBroadcastFilename("invoice.PDF"), "invoice.PDF");
  assert.equal(sanitizeBroadcastFilename("bundle.zip"), "bundle.zip");
});

test("sanitizeBroadcastFilename strips path segments", () => {
  assert.equal(sanitizeBroadcastFilename("../../secret/report.xlsx"), "report.xlsx");
});
