import { SupportedLanguage } from "@prisma/client";
import { InlineKeyboard } from "grammy";
import {
  translate,
  type TranslationKey,
} from "../localization/localization.service.js";
import { buildChannelAddLink } from "../channels/channel-add-link.js";

export interface DashboardView {
  text: string;
  keyboard: InlineKeyboard;
}

const menuItems: ReadonlyArray<{
  callback: string;
  translationKey: TranslationKey;
}> = [
  { callback: "menu:create-bot", translationKey: "menu.createBot" },
  { callback: "menu:add-channel", translationKey: "menu.addChannel" },
  { callback: "menu:my-bots", translationKey: "menu.myBots" },
  { callback: "menu:my-channels", translationKey: "menu.myChannels" },
  { callback: "menu:ads", translationKey: "menu.ads" },
  { callback: "menu:wallet", translationKey: "menu.wallet" },
  { callback: "menu:help", translationKey: "menu.help" },
];

export function buildMainMenu(language: SupportedLanguage): DashboardView {
  const keyboard = new InlineKeyboard();

  menuItems.forEach((item, index) => {
    keyboard.text(translate(language, item.translationKey), item.callback);
    if (index % 2 === 1) {
      keyboard.row();
    }
  });

  if (menuItems.length % 2 === 1) {
    keyboard.row();
  }
  keyboard.text(translate(language, "menu.language"), "language:select");

  return {
    text: translate(language, "menu.title"),
    keyboard,
  };
}

export function buildLanguageMenu(
  language: SupportedLanguage,
): DashboardView {
  return {
    text: translate(language, "language.select"),
    keyboard: new InlineKeyboard()
      .text(translate(language, "language.arabic"), "language:set:AR")
      .text(translate(language, "language.english"), "language:set:EN")
      .row()
      .text(translate(language, "menu.back"), "menu:home"),
  };
}

export function buildComingSoonMenu(
  language: SupportedLanguage,
): DashboardView {
  return {
    text: translate(language, "menu.comingSoon"),
    keyboard: new InlineKeyboard().text(
      translate(language, "menu.back"),
      "menu:home",
    ),
  };
}

export function buildBotTypeMenu(
  language: SupportedLanguage,
): DashboardView {
  return {
    text: translate(language, "botCreation.selectType"),
    keyboard: new InlineKeyboard()
      .text(
        translate(language, "botCreation.contactBot"),
        "bot:create:type:CONTACT_BOT",
      )
      .row()
      .text(
        translate(language, "botCreation.supportListBot"),
        "bot:create:type:SUPPORT_LIST_BOT",
      )
      .row()
      .text(translate(language, "menu.back"), "menu:home"),
  };
}

export function buildBotTokenPrompt(
  language: SupportedLanguage,
  messageKey:
    | "botCreation.sendToken"
    | "botCreation.invalidFormat"
    | "botCreation.invalidToken"
    | "botCreation.alreadyRegistered"
    | "botCreation.failed" = "botCreation.sendToken",
): DashboardView {
  return {
    text: translate(language, messageKey),
    keyboard: new InlineKeyboard().text(
      translate(language, "botCreation.cancel"),
      "bot:create:cancel",
    ),
  };
}

export function buildBotCreationSuccess(
  language: SupportedLanguage,
  username: string,
): DashboardView {
  return {
    text: translate(language, "botCreation.success", { username }),
    keyboard: new InlineKeyboard().text(
      translate(language, "menu.back"),
      "menu:home",
    ),
  };
}

export function buildAutomaticChannelInstructions(
  language: SupportedLanguage,
  botUsername: string,
): DashboardView {
  return {
    text: translate(language, "channelLink.autoInstructions"),
    keyboard: new InlineKeyboard()
      .url(
        translate(language, "channelLink.addBotButton"),
        buildChannelAddLink(botUsername),
      )
      .row()
      .text(translate(language, "menu.back"), "menu:home"),
  };
}
