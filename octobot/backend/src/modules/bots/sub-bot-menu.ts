import {
  BotType,
  type Bot as DatabaseBot,
  SupportedLanguage,
} from "@prisma/client";
import { InlineKeyboard } from "grammy";
import { buildChannelAddLink } from "../channels/channel-add-link.js";
import { translate } from "../localization/localization.service.js";
import { SUPPORTED_LANGUAGES } from "../localization/supported-languages.js";
import { resolveWelcomeMessage } from "./bot-welcome.service.js";
import type { DashboardView } from "./platform-menu.js";

export const CONTACT_OWNER_HOME = "owner:home";
export const CONTACT_OWNER_ADD_CHANNEL = "owner:channel:add";

export type WelcomeAction = "edit" | "view" | "reset";

const welcomeActionCode: Record<WelcomeAction, string> = {
  edit: "e",
  view: "v",
  reset: "r",
};

function localizedWelcome(
  record: DatabaseBot,
  language: SupportedLanguage,
): string {
  return resolveWelcomeMessage(record, language);
}

export function buildContactVisitorWelcome(
  record: DatabaseBot,
  language: SupportedLanguage,
): string {
  return localizedWelcome(record, language);
}

export function buildDisabledContactView(
  language: SupportedLanguage,
  platformBotUsername: string,
): DashboardView {
  return {
    text: translate(language, "contact.disabled"),
    keyboard: new InlineKeyboard().url(
      translate(language, "contact.createBot"),
      `https://t.me/${platformBotUsername}`,
    ),
  };
}

export function buildSubBotHome(
  record: DatabaseBot,
  language: SupportedLanguage,
): DashboardView {
  if (record.botType !== BotType.CONTACT_BOT) {
    return {
      text: `${localizedWelcome(record, language)}\n\n${translate(
        language,
        "channelLink.sendReference",
      )}`,
      keyboard: new InlineKeyboard().url(
        translate(language, "channelLink.addBotButton"),
        buildChannelAddLink(record.botUsername),
      ),
    };
  }
  return {
    text: translate(language, "contactOwner.title", {
      username: record.botUsername,
    }),
    keyboard: new InlineKeyboard()
      .text(
        translate(language, "contactOwner.editWelcome"),
        "owner:welcome:edit",
      )
      .text(
        translate(language, "contactOwner.viewWelcome"),
        "owner:welcome:view",
      )
      .row()
      .text(
        translate(language, "contactOwner.resetWelcome"),
        "owner:welcome:reset",
      )
      .row()
      .text(
        translate(language, "menu.addChannel"),
        CONTACT_OWNER_ADD_CHANNEL,
      )
      .text(
        translate(language, "menu.myChannels"),
        "owner:channel:list:0",
      ),
  };
}

export function buildWelcomeLanguageMenu(
  language: SupportedLanguage,
  action: WelcomeAction,
): DashboardView {
  const keyboard = new InlineKeyboard();
  for (const definition of SUPPORTED_LANGUAGES) {
    keyboard
      .text(
        translate(language, definition.labelKey),
        `owner:w:${welcomeActionCode[action]}:${definition.language}`,
      )
      .row();
  }
  keyboard.text(
    translate(language, "menu.back"),
    CONTACT_OWNER_HOME,
  );
  return {
    text: translate(language, "contactOwner.selectWelcomeLanguage"),
    keyboard,
  };
}

export function buildWelcomeView(
  record: DatabaseBot,
  interfaceLanguage: SupportedLanguage,
  contentLanguage: SupportedLanguage,
): DashboardView {
  const definition = SUPPORTED_LANGUAGES.find(
    (item) => item.language === contentLanguage,
  )!;
  return {
    text: translate(interfaceLanguage, "contactOwner.welcomeView", {
      language: translate(interfaceLanguage, definition.labelKey),
      text: localizedWelcome(record, contentLanguage),
    }),
    keyboard: new InlineKeyboard()
      .text(
        translate(interfaceLanguage, "contactOwner.editWelcome"),
        `owner:w:e:${contentLanguage}`,
      )
      .row()
      .text(
        translate(interfaceLanguage, "menu.back"),
        CONTACT_OWNER_HOME,
      ),
  };
}

export function buildWelcomeEditPrompt(
  interfaceLanguage: SupportedLanguage,
  contentLanguage: SupportedLanguage,
): DashboardView {
  const definition = SUPPORTED_LANGUAGES.find(
    (item) => item.language === contentLanguage,
  )!;
  return {
    text: translate(interfaceLanguage, "contactOwner.sendWelcome", {
      language: translate(interfaceLanguage, definition.labelKey),
    }),
    keyboard: new InlineKeyboard().text(
      translate(interfaceLanguage, "management.cancel"),
      CONTACT_OWNER_HOME,
    ),
  };
}

export function buildContactAddChannelView(
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
      .text(
        translate(language, "menu.back"),
        CONTACT_OWNER_HOME,
      ),
  };
}
