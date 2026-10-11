import assert from "node:assert/strict";
import test from "node:test";
import type { Message } from "grammy/types";
import { telegramFileRefForKind } from "./media-ingest.js";

test("telegramFileRefForKind picks largest photo", () => {
  const message = {
    photo: [
      { file_id: "small", file_unique_id: "s" },
      { file_id: "large", file_unique_id: "l" },
    ],
  } as Message;
  const ref = telegramFileRefForKind(message, "PHOTO");
  assert.deepEqual(ref, { fileId: "large", originalName: "photo.jpg" });
});

test("telegramFileRefForKind returns null when kind mismatches message", () => {
  const message = { text: "hello" } as Message;
  assert.equal(telegramFileRefForKind(message, "VIDEO"), null);
});
