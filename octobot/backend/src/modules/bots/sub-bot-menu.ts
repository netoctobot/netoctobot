import {
  type Bot as DatabaseBot,
  SupportedLanguage,
} from "@prisma/client";
import { InlineKeyboard } from "grammy";
import { buildChannelAddLink } from "../channels/channel-add-link.js";
import { translate } from "../localization/localization.service.js";
import type { DashboardView } from "./platform-menu.js";

function localizedWelcome(
  record: DatabaseBot,
  language: SupportedLanguage,
): string {
  const messages = record.welcomeMessages as Record<string, unknown>;
  const value =
    messages[language === SupportedLanguage.AR ? "ar" : "en"];
  return typeof value === "string"
    ? value
    : translate(language, "menu.comingSoon");
}

export function buildSubBotHome(
  record: DatabaseBot,
  language: SupportedLanguage,
): DashboardView {
  return {
    text: localizedWelcome(record, language),
    keyboard: new InlineKeyboard().url(
      translate(language, "channelLink.addBotButton"),
      buildChannelAddLink(record.botUsername),
    ),
  };
}
