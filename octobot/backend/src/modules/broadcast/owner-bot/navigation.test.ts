import assert from "node:assert/strict";
import test from "node:test";
import { SupportedLanguage } from "@prisma/client";
import { buildOwnerPreviewKeyboard } from "./menu.js";

test("buildOwnerPreviewKeyboard includes link rows and owner control callbacks", () => {
  const keyboard = buildOwnerPreviewKeyboard(SupportedLanguage.EN, {
    step: "preview",
    contentKind: "TEXT",
    text: "hi",
    linkButtons: [[{ text: "Go", url: "https://example.com" }]],
  });
  const flat = keyboard.inline_keyboard.flat();
  assert.ok(flat.some((button) => "url" in button && button.url === "https://example.com"));
  assert.ok(
    flat.some((button) => "callback_data" in button && button.callback_data === "owner:bc:publish"),
  );
});
