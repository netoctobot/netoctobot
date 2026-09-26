import assert from "node:assert/strict";
import test from "node:test";
import {
  BotType,
  SupportedLanguage,
} from "@prisma/client";
import {
  buildBotConfirmation,
  buildChannelConfirmation,
  buildOwnedBotsMenu,
} from "./management-menu.js";

test("builds bot list actions with direct Telegram view links", () => {
  const view = buildOwnedBotsMenu(SupportedLanguage.EN, {
    items: [
      {
        id: "bot-id",
        botUsername: "sample_bot",
        botType: BotType.CONTACT_BOT,
        isActive: true,
        activeChannelCount: 2,
      },
    ],
    page: 0,
    pageCount: 1,
    total: 1,
  });

  assert.equal(
    view.keyboard.inline_keyboard[0]?.[0]?.url,
    "https://t.me/sample_bot",
  );
  assert.equal(
    view.keyboard.inline_keyboard[0]?.[1]?.callback_data,
    "manage:b:d:bot-id:0",
  );
});

test("uses type-specific bot confirmation warnings", () => {
  const contact = buildBotConfirmation(
    SupportedLanguage.EN,
    {
      id: "contact",
      botUsername: "contact_bot",
      botType: BotType.CONTACT_BOT,
      isActive: true,
      activeChannelCount: 1,
    },
    "deactivate",
    0,
  );
  const support = buildBotConfirmation(
    SupportedLanguage.EN,
    {
      id: "support",
      botUsername: "support_bot",
      botType: BotType.SUPPORT_LIST_BOT,
      isActive: true,
      activeChannelCount: 0,
    },
    "deactivate",
    0,
  );

  assert.match(contact.text, /messages/);
  assert.doesNotMatch(support.text, /messages/);
  assert.match(support.text, /still under development/);
});

test("does not claim active channel services when no link is active", () => {
  const view = buildChannelConfirmation(
    SupportedLanguage.EN,
    {
      id: "channel",
      title: "Channel",
      username: null,
      channelTelegramId: -1001234567890n,
      isActive: true,
      activeLinkCount: 0,
      linkedBotTypes: [],
    },
    "deactivate",
    0,
  );

  assert.match(view.text, /no valid active links/);
  assert.doesNotMatch(view.text, /future publishing, ads/);
});
