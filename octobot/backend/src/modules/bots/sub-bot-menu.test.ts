import assert from "node:assert/strict";
import test from "node:test";
import {
  BotType,
  SupportedLanguage,
  type Bot as DatabaseBot,
} from "@prisma/client";
import {
  buildContactVisitorWelcome,
  buildDisabledContactView,
  buildSubBotHome,
} from "./sub-bot-menu.js";

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

test("contact visitors see only the configured welcome", () => {
  assert.equal(
    buildContactVisitorWelcome(
      databaseBot(),
      SupportedLanguage.EN,
    ),
    "Welcome",
  );
});

test("disabled contact bot links visitors to the platform bot", () => {
  const view = buildDisabledContactView(
    SupportedLanguage.EN,
    "octobot",
  );

  assert.match(view.text, /temporarily stopped/);
  assert.equal(
    view.keyboard.inline_keyboard[0]?.[0]?.url,
    "https://t.me/octobot",
  );
});
