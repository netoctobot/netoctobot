import { SupportedLanguage } from "@prisma/client";
import ar from "../../locales/ar.json" with { type: "json" };
import en from "../../locales/en.json" with { type: "json" };

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
  | "channelLink.autoInstructions"
  | "channelLink.selectBot"
  | "channelLink.noBots"
  | "channelLink.sendReference"
  | "channelLink.notFound"
  | "channelLink.ownerRequired"
  | "channelLink.botAdminRequired"
  | "channelLink.success"
  | "channelLink.failed"
  | "channelLink.cancel"
  | "errors.privateOnly"
  | "errors.generic";

const catalogs: Record<SupportedLanguage, unknown> = {
  [SupportedLanguage.AR]: ar,
  [SupportedLanguage.EN]: en,
};

export function normalizeTelegramLanguage(
  languageCode?: string,
): SupportedLanguage {
  const normalized = languageCode?.toLowerCase();
  if (normalized?.startsWith("ar")) {
    return SupportedLanguage.AR;
  }
  return SupportedLanguage.EN;
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
