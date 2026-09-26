import { SupportedLanguage } from "@prisma/client";
import ar from "../../locales/ar.json" with { type: "json" };
import en from "../../locales/en.json" with { type: "json" };
import { languageFromTelegram } from "./supported-languages.js";

export type TranslationKey =
  | "app.name"
  | "health.ok"
  | "menu.title"
  | "menu.createBot"
  | "menu.addChannel"
  | "menu.myBots"
  | "menu.myChannels"
  | "menu.ads"
  | "menu.wallet"
  | "menu.help"
  | "menu.language"
  | "menu.comingSoon"
  | "menu.back"
  | "language.select"
  | "language.arabic"
  | "language.english"
  | "defaults.contactWelcome"
  | "defaults.supportWelcome"
  | "defaults.footer"
  | "botCreation.selectType"
  | "botCreation.contactBot"
  | "botCreation.supportListBot"
  | "botCreation.sendToken"
  | "botCreation.invalidFormat"
  | "botCreation.invalidToken"
  | "botCreation.alreadyRegistered"
  | "botCreation.success"
  | "botCreation.failed"
  | "botCreation.cancel"
  | "contact.privateReplyAnchor"
  | "contact.deliveryFailed"
  | "contact.replyRequired"
  | "contact.replyFailed"
  | "contact.disabled"
  | "contact.createBot"
  | "contactOwner.title"
  | "contactOwner.editWelcome"
  | "contactOwner.viewWelcome"
  | "contactOwner.resetWelcome"
  | "contactOwner.selectWelcomeLanguage"
  | "contactOwner.welcomeView"
  | "contactOwner.sendWelcome"
  | "contactOwner.invalidWelcome"
  | "contactOwner.linkedChannelsTitle"
  | "contactOwner.noLinkedChannels"
  | "contactOwner.deactivateLinkWarning"
  | "contactOwner.removeLinkWarning"
  | "contactOwner.privateChannelLink"
  | "channelLink.autoInstructions"
  | "channelLink.addBotButton"
  | "channelLink.selectBot"
  | "channelLink.noBots"
  | "channelLink.sendReference"
  | "channelLink.notFound"
  | "channelLink.administratorRequired"
  | "channelLink.botAdminRequired"
  | "channelLink.requiredPermissions"
  | "channelLink.success"
  | "channelLink.failed"
  | "channelLink.removed"
  | "channelLink.permissionsLost"
  | "channelLink.relinkRequired"
  | "management.active"
  | "management.inactive"
  | "management.previous"
  | "management.next"
  | "management.view"
  | "management.activate"
  | "management.deactivate"
  | "management.delete"
  | "management.confirm"
  | "management.cancel"
  | "management.botsTitle"
  | "management.noBots"
  | "management.channelsTitle"
  | "management.noChannels"
  | "management.contactDeactivateWarning"
  | "management.contactDeleteWarning"
  | "management.supportDeactivateWarning"
  | "management.supportDeleteWarning"
  | "management.channelDeactivateWarning"
  | "management.channelInactiveLinksWarning"
  | "management.channelDeleteWarning"
  | "management.privateChannelView"
  | "management.botActivated"
  | "management.botDeactivated"
  | "management.botDeleted"
  | "management.channelActivated"
  | "management.channelDeactivated"
  | "management.channelDeleted"
  | "management.notFound"
  | "management.actionFailed"
  | "errors.privateOnly"
  | "errors.generic";

const catalogs: Record<SupportedLanguage, unknown> = {
  [SupportedLanguage.AR]: ar,
  [SupportedLanguage.EN]: en,
};

export function normalizeTelegramLanguage(
  languageCode?: string,
): SupportedLanguage {
  return languageFromTelegram(languageCode);
}

export function translate(
  language: SupportedLanguage,
  key: TranslationKey,
  variables: Record<string, string | number> = {},
): string {
  let value: unknown = catalogs[language];
  for (const segment of key.split(".")) {
    if (!value || typeof value !== "object" || !(segment in value)) {
      throw new Error(`Missing translation: ${language}.${key}`);
    }
    value = (value as Record<string, unknown>)[segment];
  }

  if (typeof value !== "string") {
    throw new Error(`Translation is not text: ${language}.${key}`);
  }

  return value.replace(/\{\{(\w+)\}\}/g, (_, name: string) =>
    String(variables[name] ?? `{{${name}}}`),
  );
}
