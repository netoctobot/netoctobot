import assert from "node:assert/strict";
import test from "node:test";
import {
  applyAudienceSelection,
  applyBackNavigation,
  cancelInputMode,
} from "./state.js";
import { resolveMediaCaption, isCaptionWithinLimit } from "./owner-media.js";
import { parseOwnerBroadcastButtonText } from "./button-text.js";

test("flow text then add photo caption from text body", () => {
  let draft = applyAudienceSelection({ step: "audience" }, "channels");
  assert.equal(draft.step, "awaitPost");
  draft = {
    ...draft,
    contentKind: "TEXT",
    text: "Hello world",
    step: "preview",
  };
  const caption = resolveMediaCaption({
    messageCaption: undefined,
    textFromTextPost: draft.text ?? null,
    existingCaption: draft.caption,
  });
  assert.equal(caption, "Hello world");
  assert.equal(isCaptionWithinLimit(caption), true);
  draft = {
    ...draft,
    contentKind: "PHOTO",
    text: "",
    caption,
    mediaAssetId: "asset-1",
    step: "preview",
  };
  draft = { ...draft, inputMode: "buttons", step: "awaitButtons" };
  const parsed = parseOwnerBroadcastButtonText("Site - https://example.com");
  assert.equal(parsed.ok, true);
  if (parsed.ok) {
    draft = { ...cancelInputMode(draft), linkButtons: parsed.rows, step: "preview" };
  }
  const backToAudience = applyBackNavigation(draft);
  assert.notEqual(backToAudience, "home");
  if (backToAudience !== "home") {
    assert.equal(backToAudience.step, "audience");
    assert.equal(backToAudience.linkButtons?.length, 1);
  }
  const reselect = applyAudienceSelection(
    backToAudience === "home" ? draft : backToAudience,
    "users",
  );
  assert.equal(reselect.step, "preview");
  assert.equal(reselect.audience, "users");
});

test("flow media preview to button help and back keeps media", () => {
  let draft = {
    step: "preview",
    contentKind: "VIDEO" as const,
    mediaAssetId: "v1",
    caption: "clip",
    audience: "both" as const,
  };
  draft = { ...draft, inputMode: "buttons", step: "awaitButtons" };
  const back = applyBackNavigation(draft);
  assert.notEqual(back, "home");
  if (back !== "home") {
    assert.equal(back.step, "preview");
    assert.equal(back.inputMode, null);
    assert.equal(back.mediaAssetId, "v1");
  }
});
