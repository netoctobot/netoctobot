import {
  BotType,
  type Bot as DatabaseBot,
  type PrismaClient,
  type SupportedLanguage,
} from "@prisma/client";
import {
  DEFAULT_LANGUAGE,
  languageDefinition,
  SUPPORTED_LANGUAGES,
} from "../localization/supported-languages.js";
import {
  translate,
  type TranslationKey,
} from "../localization/localization.service.js";

type LocalizedText = Record<string, string>;

function defaultWelcomeKey(botType: BotType): TranslationKey {
  return botType === BotType.SUPPORT_LIST_BOT
    ? "defaults.supportWelcome"
    : "defaults.contactWelcome";
}

export function defaultWelcomeMessages(
  botType: BotType,
): LocalizedText {
  const key = defaultWelcomeKey(botType);
  return Object.fromEntries(
    SUPPORTED_LANGUAGES.map((definition) => [
      definition.storageKey,
      translate(definition.language, key),
    ]),
  );
}

export function defaultFooterTexts(): LocalizedText {
  return Object.fromEntries(
    SUPPORTED_LANGUAGES.map((definition) => [
      definition.storageKey,
      translate(definition.language, "defaults.footer"),
    ]),
  );
}

export function resolveWelcomeMessage(
  record: Pick<DatabaseBot, "botType" | "welcomeMessages">,
  language: SupportedLanguage,
): string {
  const messages =
    record.welcomeMessages &&
    typeof record.welcomeMessages === "object" &&
    !Array.isArray(record.welcomeMessages)
      ? (record.welcomeMessages as Record<string, unknown>)
      : {};
  const requested =
    messages[languageDefinition(language).storageKey];
  if (typeof requested === "string" && requested.length > 0) {
    return requested;
  }
  const fallback =
    messages[languageDefinition(DEFAULT_LANGUAGE).storageKey];
  if (typeof fallback === "string" && fallback.length > 0) {
    return fallback;
  }
  const anyValue = Object.values(messages).find(
    (value): value is string =>
      typeof value === "string" && value.length > 0,
  );
  return (
    anyValue ??
    defaultWelcomeMessages(record.botType)[
      languageDefinition(language).storageKey
    ]!
  );
}

export async function setWelcomeMessage(
  prisma: PrismaClient,
  botId: string,
  language: SupportedLanguage,
  text: string,
): Promise<DatabaseBot> {
  const record = await prisma.bot.findUniqueOrThrow({
    where: { id: botId },
  });
  const messages = {
    ...(record.welcomeMessages as LocalizedText),
    [languageDefinition(language).storageKey]: text,
  };
  return prisma.bot.update({
    where: { id: botId },
    data: { welcomeMessages: messages },
  });
}

export async function resetWelcomeMessage(
  prisma: PrismaClient,
  botId: string,
  language: SupportedLanguage,
): Promise<DatabaseBot> {
  const record = await prisma.bot.findUniqueOrThrow({
    where: { id: botId },
  });
  const messages = {
    ...(record.welcomeMessages as LocalizedText),
    [languageDefinition(language).storageKey]:
      defaultWelcomeMessages(record.botType)[
        languageDefinition(language).storageKey
      ]!,
  };
  return prisma.bot.update({
    where: { id: botId },
    data: { welcomeMessages: messages },
  });
}
