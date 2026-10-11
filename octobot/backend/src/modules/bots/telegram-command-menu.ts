import type { Api } from "grammy";
import type { BotCommand } from "grammy/types";

export const TELEGRAM_START_COMMAND = "start";

export const TELEGRAM_START_DESCRIPTION_AR = "فتح القائمة الرئيسية";
export const TELEGRAM_START_DESCRIPTION_EN = "Open main menu";

export function mergeStartCommand(
  existing: readonly BotCommand[],
  startDescription: string,
): BotCommand[] {
  const others = existing.filter(
    (command) => command.command !== TELEGRAM_START_COMMAND,
  );
  return [
    { command: TELEGRAM_START_COMMAND, description: startDescription },
    ...others,
  ];
}

async function setCommandsForLanguage(
  api: Api,
  commands: BotCommand[],
  languageCode?: "ar" | "en",
): Promise<void> {
  if (languageCode) {
    await api.setMyCommands(commands, { language_code: languageCode });
    return;
  }
  await api.setMyCommands(commands);
}

/**
 * Registers localized /start help and enables the commands menu button.
 * Failures are logged and must not block bot startup.
 */
export async function ensureTelegramCommandMenu(
  api: Api,
  log: (message: string) => void = () => undefined,
): Promise<void> {
  try {
    const defaultExisting = await api.getMyCommands().catch(() => [] as BotCommand[]);
    await setCommandsForLanguage(
      api,
      mergeStartCommand(defaultExisting, TELEGRAM_START_DESCRIPTION_EN),
    );

    for (const [languageCode, description] of [
      ["ar", TELEGRAM_START_DESCRIPTION_AR],
      ["en", TELEGRAM_START_DESCRIPTION_EN],
    ] as const) {
      const existing = await api
        .getMyCommands({ language_code: languageCode })
        .catch(() => [] as BotCommand[]);
      await setCommandsForLanguage(
        api,
        mergeStartCommand(existing, description),
        languageCode,
      );
    }

    await api.setChatMenuButton({
      menu_button: { type: "commands" },
    });
  } catch (error) {
    const reason =
      error instanceof Error ? error.message : "Unknown Telegram API error";
    log(`Telegram command menu setup failed: ${reason}`);
  }
}
