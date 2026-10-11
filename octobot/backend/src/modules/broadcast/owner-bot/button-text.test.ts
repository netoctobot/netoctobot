import assert from "node:assert/strict";
import test from "node:test";
import { parseOwnerBroadcastButtonText } from "./button-text.js";

test("parseOwnerBroadcastButtonText builds rows and styles", () => {
  const result = parseOwnerBroadcastButtonText(
    "قناة أولى - https://example.com | قناة ثانية - https://example.org\nموقعنا - https://example.net - style:blue",
  );
  assert.equal(result.ok, true);
  if (!result.ok) {
    return;
  }
  assert.equal(result.rows.length, 2);
  assert.equal(result.rows[0].length, 2);
  assert.equal(result.rows[1][0].style, "primary");
});

test("parseOwnerBroadcastButtonText rejects invalid url", () => {
  const result = parseOwnerBroadcastButtonText("bad - ftp://x.com");
  assert.equal(result.ok, false);
});
