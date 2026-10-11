import assert from "node:assert/strict";
import test from "node:test";
import {
  applyAudienceSelection,
  applyBackNavigation,
  applyAudienceSelection as selectAudience,
  cancelInputMode,
  hasPublishableContent,
} from "./state.js";

test("applyAudienceSelection goes to preview when post already exists", () => {
  const next = applyAudienceSelection(
    {
      step: "audience",
      audience: "channels",
      contentKind: "TEXT",
      text: "hello",
    },
    "users",
  );
  assert.equal(next.audience, "users");
  assert.equal(next.step, "preview");
});

test("applyAudienceSelection goes to awaitPost when empty", () => {
  const next = applyAudienceSelection({ step: "audience" }, "both");
  assert.equal(next.step, "awaitPost");
});

test("back from button input returns to preview without losing content", () => {
  const next = applyBackNavigation({
    step: "preview",
    inputMode: "buttons",
    contentKind: "TEXT",
    text: "body",
    linkButtons: [[{ text: "A", url: "https://example.com" }]],
  });
  assert.notEqual(next, "home");
  if (next === "home") {
    assert.fail();
  }
  assert.equal(next.inputMode, null);
  assert.equal(next.step, "preview");
  assert.equal(next.text, "body");
});

test("back from preview keeps content and shows audience step", () => {
  const next = applyBackNavigation({
    step: "preview",
    contentKind: "PHOTO",
    mediaAssetId: "m1",
    caption: "cap",
  });
  assert.notEqual(next, "home");
  if (next === "home") {
    assert.fail();
  }
  assert.equal(next.step, "audience");
  assert.equal(next.mediaAssetId, "m1");
});

test("reselect audience with existing post jumps to preview", () => {
  const draft = selectAudience(
    {
      step: "audience",
      contentKind: "TEXT",
      text: "post",
      audience: "channels",
    },
    "users",
  );
  assert.equal(draft.step, "preview");
  assert.equal(hasPublishableContent(draft), true);
});

test("cancelInputMode from media wait restores preview", () => {
  const next = cancelInputMode({
    step: "awaitMedia",
    inputMode: "media",
    contentKind: "VIDEO",
    mediaAssetId: "v1",
  });
  assert.equal(next.step, "preview");
  assert.equal(next.inputMode, null);
});
