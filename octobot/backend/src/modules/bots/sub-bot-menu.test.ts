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
  buildWelcomeLanguageMenu,
} from "./sub-bot-menu.js";
import { SUPPORTED_LANGUAGES } from "../localization/supported-languages.js";

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

test("contact owner home contains welcome and channel controls", () => {
  const view = buildSubBotHome(databaseBot(), SupportedLanguage.AR);
  const keyboard = view.keyboard.inline_keyboard.flat();
  const callbacks = keyboard.flatMap((button) =>
    "callback_data" in button ? [button.callback_data] : [],
  );

  assert.match(view.text, /لوحة إدارة/);
  assert.ok(callbacks.includes("owner:welcome:edit"));
  assert.ok(callbacks.includes("owner:welcome:view"));
  assert.ok(callbacks.includes("owner:welcome:reset"));
  assert.ok(callbacks.includes("owner:channel:add"));
  assert.ok(callbacks.includes("owner:channel:list:0"));
});

test("welcome language menu is generated from the registry", () => {
  const view = buildWelcomeLanguageMenu(
    SupportedLanguage.EN,
    "edit",
  );
  const languageCallbacks = view.keyboard.inline_keyboard
    .flat()
    .flatMap((button) =>
      "callback_data" in button &&
      button.callback_data.startsWith("owner:w:e:")
        ? [button.callback_data]
        : [],
    );

  assert.equal(
    languageCallbacks.length,
    SUPPORTED_LANGUAGES.length,
  );
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
