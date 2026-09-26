import assert from "node:assert/strict";
import test from "node:test";
import {
  BotType,
  SupportedLanguage,
  type Bot as DatabaseBot,
} from "@prisma/client";
import { buildSubBotHome } from "./sub-bot-menu.js";

function databaseBot(): DatabaseBot {
  return {
    botUsername: "channel_helper_bot",
    botType: BotType.CONTACT_BOT,
    welcomeMessages: {
      ar: "مرحباً",
      en: "Welcome",
    },
  } as DatabaseBot;
}

test("sub-bot home accepts forwarding without an extra recovery button", () => {
  const view = buildSubBotHome(databaseBot(), SupportedLanguage.AR);
  const keyboard = view.keyboard.inline_keyboard.flat();

  assert.match(view.text, /حوّل مباشرة رسالة منشورة من القناة/);
  assert.equal(
    keyboard.some(
      (button) =>
        "callback_data" in button &&
        button.callback_data === "channel-link:start-manual",
    ),
    false,
  );
  assert.equal(keyboard.some((button) => "url" in button), true);
});
