import {
  Bot as TelegramBot,
  type Context,
} from "grammy";
import {
  BotType,
  type Bot as DatabaseBot,
  type PrismaClient,
  SupportedLanguage,
} from "@prisma/client";
import type { Env } from "./config/env.js";
import { encryptToken } from "./lib/token-crypto.js";
import {
  buildComingSoonMenu,
  buildLanguageMenu,
  buildMainMenu,
} from "./modules/bots/platform-menu.js";
import {
  normalizeTelegramLanguage,
  translate,
} from "./modules/localization/localization.service.js";
import {
  setExplicitLanguage,
  syncPlatformUser,
} from "./modules/users/user.service.js";

export interface PlatformBotRuntime {
  bot: TelegramBot;
  botRecord: DatabaseBot;
}

async function editDashboard(
  context: Context,
  view: ReturnType<
    typeof buildMainMenu | typeof buildLanguageMenu | typeof buildComingSoonMenu
  >,
): Promise<void> {
  await context.editMessageText(view.text, {
    reply_markup: view.keyboard,
  });
}

function registerPlatformHandlers(
  bot: TelegramBot,
  prisma: PrismaClient,
  platformBotId: string,
): void {
  bot.command("start", async (context) => {
    if (!context.from) {
      return;
    }

    if (context.chat.type !== "private") {
      await context.reply(
        translate(
          normalizeTelegramLanguage(context.from.language_code),
          "errors.privateOnly",
        ),
      );
      return;
    }

    const { preference } = await syncPlatformUser(
      prisma,
      context.from,
      platformBotId,
    );
    const view = buildMainMenu(preference.language);
    await context.reply(view.text, { reply_markup: view.keyboard });
  });

  bot.callbackQuery("menu:home", async (context) => {
    const { preference } = await syncPlatformUser(
      prisma,
      context.from,
      platformBotId,
    );
    await editDashboard(context, buildMainMenu(preference.language));
    await context.answerCallbackQuery();
  });

  bot.callbackQuery("language:select", async (context) => {
    const { preference } = await syncPlatformUser(
      prisma,
      context.from,
      platformBotId,
    );
    await editDashboard(context, buildLanguageMenu(preference.language));
    await context.answerCallbackQuery();
  });

  bot.callbackQuery(/^language:set:(AR|EN)$/, async (context) => {
    const { user } = await syncPlatformUser(
      prisma,
      context.from,
      platformBotId,
    );
    const language = context.match[1] as SupportedLanguage;
    await setExplicitLanguage(prisma, user.id, platformBotId, language);
    await editDashboard(context, buildMainMenu(language));
    await context.answerCallbackQuery();
  });

  bot.callbackQuery(
    /^menu:(create-bot|add-channel|my-bots|my-channels|ads|wallet|help)$/,
    async (context) => {
      const { preference } = await syncPlatformUser(
        prisma,
        context.from,
        platformBotId,
      );
      await editDashboard(context, buildComingSoonMenu(preference.language));
      await context.answerCallbackQuery();
    },
  );
}

export async function createPlatformBotRuntime(
  env: Env,
  prisma: PrismaClient,
): Promise<PlatformBotRuntime> {
  const bot = new TelegramBot(env.BOT_TOKEN);
  await bot.init();

  const botRecord = await prisma.$transaction(async (transaction) => {
    const owner = await transaction.user.upsert({
      where: { telegramId: env.OWNER_TELEGRAM_ID },
      create: { telegramId: env.OWNER_TELEGRAM_ID },
      update: { deletedAt: null },
    });

    const platformBot = await transaction.bot.upsert({
      where: { telegramBotId: BigInt(bot.botInfo.id) },
      create: {
        ownerId: owner.id,
        telegramBotId: BigInt(bot.botInfo.id),
        tokenEncrypted: encryptToken(env.BOT_TOKEN, env.ENCRYPTION_KEY),
        botUsername: bot.botInfo.username,
        botType: BotType.PLATFORM_BOT,
        welcomeMessages: {
          ar: "مرحباً بك في أوكتوبوت",
          en: "Welcome to Octobot",
        },
        footerTexts: {
          ar: "تم الإنشاء بواسطة أوكتوبوت",
          en: "Created with Octobot",
        },
      },
      update: {
        ownerId: owner.id,
        tokenEncrypted: encryptToken(env.BOT_TOKEN, env.ENCRYPTION_KEY),
        encryptionKeyVersion: 1,
        botUsername: bot.botInfo.username,
        botType: BotType.PLATFORM_BOT,
        isActive: true,
        deletedAt: null,
      },
    });

    await transaction.platformSettings.upsert({
      where: { id: "default" },
      create: {
        id: "default",
        platformBotId: platformBot.id,
      },
      update: {
        platformBotId: platformBot.id,
      },
    });

    return platformBot;
  });

  registerPlatformHandlers(bot, prisma, botRecord.id);
  return { bot, botRecord };
}

export async function registerPlatformWebhook(
  runtime: PlatformBotRuntime,
  env: Env,
): Promise<void> {
  if (!env.WEBHOOK_REGISTRATION_ENABLED) {
    return;
  }

  const baseUrl = env.PUBLIC_BASE_URL.endsWith("/")
    ? env.PUBLIC_BASE_URL
    : `${env.PUBLIC_BASE_URL}/`;
  const webhookUrl = new URL(
    `webhooks/telegram/${runtime.botRecord.id}`,
    baseUrl,
  ).toString();

  await runtime.bot.api.setWebhook(webhookUrl, {
    secret_token: env.WEBHOOK_SECRET,
    allowed_updates: ["message", "callback_query"],
  });
}
