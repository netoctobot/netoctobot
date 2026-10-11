import assert from "node:assert/strict";
import test from "node:test";
import { clearContentForKindChange } from "./state.js";

test("switching from PHOTO compose to TEXT clears media and cancels caption input mode", () => {
  const next = clearContentForKindChange(
    {
      step: "compose",
      contentKind: "PHOTO",
      caption: "keep?",
      mediaAssetId: "asset-1",
      inputMode: "caption",
      linkButtons: [[{ text: "Go", url: "https://example.com" }]],
    },
    "TEXT",
  );
  assert.equal(next.step, "awaitContent");
  assert.equal(next.inputMode, null);
  assert.equal(next.mediaAssetId, null);
  assert.equal(next.caption, null);
  assert.ok(next.linkButtons && next.linkButtons.length > 0);
});

test("switching from TEXT to VIDEO resets text and awaits new media", () => {
  const next = clearContentForKindChange(
    { step: "preview", contentKind: "TEXT", text: "body", inputMode: "buttons" },
    "VIDEO",
  );
  assert.equal(next.contentKind, "VIDEO");
  assert.equal(next.text, "");
  assert.equal(next.step, "awaitContent");
  assert.equal(next.inputMode, null);
});
