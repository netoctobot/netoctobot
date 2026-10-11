import assert from "node:assert/strict";
import test from "node:test";
import { buildLinkButtonRows, type LinkButtonEditorEntry } from "./broadcast-link-buttons.js";

test("buildLinkButtonRows respects new_row and after_previous", () => {
  const buttons: LinkButtonEditorEntry[] = [
    { text: "A", url: "https://a.test", placement: "new_row", color: "default" },
    { text: "B", url: "https://b.test", placement: "after_previous", color: "blue" },
    { text: "C", url: "https://c.test", placement: "new_row", color: "red" },
  ];
  const rows = buildLinkButtonRows(buttons);
  assert.deepEqual(rows, [
    [
      { text: "A", url: "https://a.test" },
      { text: "B", url: "https://b.test", style: "primary" },
    ],
    [{ text: "C", url: "https://c.test", style: "danger" }],
  ]);
});

test("buildLinkButtonRows skips empty cells and omits default color style", () => {
  const rows = buildLinkButtonRows([
    { text: " ", url: "https://x.test", placement: "new_row", color: "green" },
    { text: "Ok", url: "", placement: "new_row", color: "default" },
    { text: "Go", url: "https://go.test", placement: "new_row", color: "green" },
  ]);
  assert.deepEqual(rows, [[{ text: "Go", url: "https://go.test", style: "success" }]]);
});

test("first button with after_previous still starts a row", () => {
  const rows = buildLinkButtonRows([
    { text: "Only", url: "https://only.test", placement: "after_previous", color: "default" },
  ]);
  assert.deepEqual(rows, [[{ text: "Only", url: "https://only.test" }]]);
});
