import assert from "node:assert/strict";
import test from "node:test";
import {
  detectContentKindFromBuffer,
  kindMatchesDetection,
  parseBroadcastContent,
  parseLinkButtons,
  TELEGRAM_LIMITS,
} from "./content.js";

test("parseBroadcastContent rejects text over Telegram limit", () => {
  const body = { contentKind: "TEXT", text: "x".repeat(TELEGRAM_LIMITS.textMessageChars + 1) };
  assert.equal(parseBroadcastContent(body), null);
});

test("parseBroadcastContent requires media id for non-text kinds", () => {
  assert.equal(parseBroadcastContent({ contentKind: "PHOTO" }), null);
  const ok = parseBroadcastContent({
    contentKind: "PHOTO",
    mediaUploadId: "upload_1",
    caption: "hi",
    linkButtons: { rows: [[{ text: "Go", url: "https://example.com" }]] },
  });
  assert.ok(ok);
  assert.equal(ok?.caption, "hi");
  assert.equal(ok?.linkButtons?.[0][0].text, "Go");
});

test("parseLinkButtons validates https URLs and button text length", () => {
  assert.equal(parseLinkButtons({ rows: [[{ text: "", url: "https://x.com" }]] }), null);
  assert.equal(parseLinkButtons({ rows: [[{ text: "x", url: "ftp://x.com" }]] }), null);
  const long = "a".repeat(TELEGRAM_LIMITS.inlineButtonTextChars + 1);
  assert.equal(parseLinkButtons({ rows: [[{ text: long, url: "https://x.com" }]] }), null);
});

test("detectContentKindFromBuffer uses magic bytes not filename", () => {
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0x00]);
  assert.equal(detectContentKindFromBuffer(jpeg), "PHOTO");
  assert.equal(kindMatchesDetection("PHOTO", detectContentKindFromBuffer(jpeg)!), true);
  assert.equal(kindMatchesDetection("VIDEO", detectContentKindFromBuffer(jpeg)!), false);
});
