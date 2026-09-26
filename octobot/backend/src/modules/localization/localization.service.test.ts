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

test("offers immediate forwarding and automatic channel detection", () => {
  const arabicInstructions = translate(
    SupportedLanguage.AR,
    "channelLink.autoInstructions",
  );
  const englishInstructions = translate(
    SupportedLanguage.EN,
    "channelLink.autoInstructions",
  );

  assert.match(arabicInstructions, /^حوّل الآن رسالة منشورة/);
  assert.match(arabicInstructions, /سيستشعر الإضافة/);
  assert.match(arabicInstructions, /مشرفاً أو مالكاً/);
  assert.doesNotMatch(arabicInstructions, /البوت مضاف مشرفاً مسبقاً/);

  assert.match(englishInstructions, /^Forward a published channel message now/);
  assert.match(englishInstructions, /detect the addition/i);
  assert.match(englishInstructions, /administrator or owner/i);
  assert.doesNotMatch(
    englishInstructions,
    /Bot is already an administrator/,
  );
});

test("manual channel-link prompt leads with the forwarding option", () => {
  assert.match(
    translate(SupportedLanguage.AR, "channelLink.sendReference"),
    /^حوّل مباشرة رسالة منشورة من القناة/,
  );
  assert.match(
    translate(SupportedLanguage.EN, "channelLink.sendReference"),
    /^Directly forward a published message from the channel/,
  );
});
