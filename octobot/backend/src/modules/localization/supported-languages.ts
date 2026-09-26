import { SupportedLanguage } from "@prisma/client";

export interface SupportedLanguageDefinition {
  language: SupportedLanguage;
  storageKey: string;
  telegramPrefixes: readonly string[];
  labelKey: "language.arabic" | "language.english";
}

export const SUPPORTED_LANGUAGES: readonly SupportedLanguageDefinition[] =
  [
    {
      language: SupportedLanguage.AR,
      storageKey: "ar",
      telegramPrefixes: ["ar"],
      labelKey: "language.arabic",
    },
    {
      language: SupportedLanguage.EN,
      storageKey: "en",
      telegramPrefixes: ["en"],
      labelKey: "language.english",
    },
  ];

export const DEFAULT_LANGUAGE = SupportedLanguage.EN;

export function languageDefinition(
  language: SupportedLanguage,
): SupportedLanguageDefinition {
  return (
    SUPPORTED_LANGUAGES.find(
      (definition) => definition.language === language,
    ) ??
    SUPPORTED_LANGUAGES.find(
      (definition) => definition.language === DEFAULT_LANGUAGE,
    )!
  );
}

export function parseSupportedLanguage(
  value: string,
): SupportedLanguage | null {
  return (
    SUPPORTED_LANGUAGES.find(
      (definition) => definition.language === value,
    )?.language ?? null
  );
}

export function languageFromTelegram(
  languageCode?: string,
): SupportedLanguage {
  const normalized = languageCode?.toLowerCase();
  return (
    SUPPORTED_LANGUAGES.find((definition) =>
      definition.telegramPrefixes.some((prefix) =>
        normalized?.startsWith(prefix),
      ),
    )?.language ?? DEFAULT_LANGUAGE
  );
}
