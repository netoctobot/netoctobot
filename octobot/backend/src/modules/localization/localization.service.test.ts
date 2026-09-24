import assert from "node:assert/strict";
import test from "node:test";
import { SupportedLanguage } from "@prisma/client";
import {
  normalizeTelegramLanguage,
  translate,
} from "./localization.service.js";

test("normalizes Telegram language codes", () => {
  assert.equal(normalizeTelegramLanguage("ar"), SupportedLanguage.AR);
  assert.equal(normalizeTelegramLanguage("ar-SA"), SupportedLanguage.AR);
  assert.equal(normalizeTelegramLanguage("en-US"), SupportedLanguage.EN);
  assert.equal(normalizeTelegramLanguage("fr"), SupportedLanguage.EN);
  assert.equal(normalizeTelegramLanguage(), SupportedLanguage.EN);
});

test("loads menu translations for both supported languages", () => {
  assert.equal(translate(SupportedLanguage.AR, "menu.wallet"), "المحفظة");
  assert.equal(translate(SupportedLanguage.EN, "menu.wallet"), "Wallet");
});
