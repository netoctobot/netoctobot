import assert from "node:assert/strict";
import test from "node:test";
import { LinkStatus, SupportedLanguage } from "@prisma/client";
import { buildManagedBotChannelsMenu } from "./contact-channel-menu.js";

const page = {
  items: [
    {
      id: "link-id",
      status: LinkStatus.ACTIVE,
      channelId: "channel-id",
      title: "Channel",
      username: "channel_name",
      channelTelegramId: -1001234567890n,
      channelIsActive: true,
    },
  ],
  page: 0,
  pageCount: 1,
  total: 1,
};

test("main and sub-bot channel lists share the same presentation", () => {
  const contact = buildManagedBotChannelsMenu(
    SupportedLanguage.EN,
    page,
    "CONTACT",
  );
  const platform = buildManagedBotChannelsMenu(
    SupportedLanguage.EN,
    page,
    "PLATFORM",
  );

  assert.equal(contact.text, platform.text);
  assert.equal(
    contact.keyboard.inline_keyboard.length,
    platform.keyboard.inline_keyboard.length,
  );
  assert.match(
    contact.keyboard.inline_keyboard[0]?.[1]?.callback_data ?? "",
    /^owner:c:d:/,
  );
  assert.match(
    platform.keyboard.inline_keyboard[0]?.[1]?.callback_data ?? "",
    /^manage:l:d:/,
  );
});
