import assert from "node:assert/strict";
import test from "node:test";
import { clearContentForKindChange } from "./state.js";

test("clearContentForKindChange drops media when switching to TEXT", () => {
  const next = clearContentForKindChange(
    {
      step: "compose",
      contentKind: "PHOTO",
      text: "",
      caption: "cap",
      mediaAssetId: "m1",
      inputMode: "caption",
    },
    "TEXT",
  );
  assert.equal(next.contentKind, "TEXT");
  assert.equal(next.mediaAssetId, null);
  assert.equal(next.caption, null);
  assert.equal(next.inputMode, null);
});

test("clearContentForKindChange clears text when switching to media", () => {
  const next = clearContentForKindChange(
    { step: "compose", contentKind: "TEXT", text: "hello", inputMode: "buttons" },
    "PHOTO",
  );
  assert.equal(next.text, "");
  assert.equal(next.mediaAssetId, null);
});
