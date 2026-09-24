import {
  Bot as TelegramBot,
  type Context,
} from "grammy";
import {
  BotType,
  type PrismaClient,
  SupportedLanguage,
} from "@prisma/client";
import type { Redis } from "ioredis";
import type { Env } from "./config/env.js";
import { encryptToken } from "./lib/token-crypto.js";
import {
  buildBotCreationSuccess,
  buildBotTokenPrompt,
  buildBotTypeMenu,
  buildComingSoonMenu,
  buildLanguageMenu,
  buildMainMenu,
  type DashboardView,
} from "./modules/bots/platform-menu.js";
import {
  BotAlreadyRegisteredError,
  type BotRuntimeManager,
  InvalidBotTokenError,
  isBotTokenFormatValid,
  type ManagedBotRuntime,
} from "./modules/bots/bot-runtime-manager.js";
import {
  clearBotCreationState,
  getBotCreationState,
  saveBotCreationState,
} from "./modules/bots/bot-creation-state.js";
import {
  normalizeTelegramLanguage,
  translate,
} from "./modules/localization/localization.service.js";
import {
  setExplicitLanguage,
  syncPlatformUser,
} from "./modules/users/user.service.js";

export type PlatformBotRuntime = ManagedBotRuntime;

async function editDashboard(
  context: Context,
  view: DashboardView,
): Promise<void> {
  await context.editMessageText(view.text, {
    reply_markup: view.keyboard,
  });
}

function registerPlatformHandlers(
  bot: TelegramBot,
  prisma: PrismaClient,
  platformBotId: string,
  runtimeManager: BotRuntimeManager,
  redis: Redis,
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
    await clearBotCreationState(redis, context.from.id);
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

  bot.callbackQuery("menu:create-bot", async (context) => {
    await clearBotCreationState(redis, context.from.id);
    const { preference } = await syncPlatformUser(
      prisma,
      context.from,
      platformBotId,
    );
    await editDashboard(context, buildBotTypeMenu(preference.language));
    await context.answerCallbackQuery();
  });

  bot.callbackQuery(
    /^bot:create:type:(CONTACT_BOT|SUPPORT_LIST_BOT)$/,
    async (context) => {
      const message = context.callbackQuery.message;
      if (!message || context.chat?.type !== "private") {
        await context.answerCallbackQuery();
        return;
      }

      const { user, preference } = await syncPlatformUser(
        prisma,
        context.from,
        platformBotId,
      );
      const botType = context.match[1] as Extract<
        BotType,
        "CONTACT_BOT" | "SUPPORT_LIST_BOT"
      >;
      await saveBotCreationState(redis, context.from.id, {
        ownerId: user.id,
        botType,
        chatId: context.chat.id,
        dashboardMessageId: message.message_id,
      });
      await editDashboard(
        context,
        buildBotTokenPrompt(preference.language),
      );
      await context.answerCallbackQuery();
    },
  );

  bot.callbackQuery("bot:create:cancel", async (context) => {
    await clearBotCreationState(redis, context.from.id);
    const { preference } = await syncPlatformUser(
      prisma,
      context.from,
      platformBotId,
    );
    await editDashboard(context, buildMainMenu(preference.language));
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
    /^menu:(add-channel|my-bots|my-channels|ads|wallet|help)$/,
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

  bot.on("message:text", async (context) => {
    if (!context.from || context.chat.type !== "private") {
      return;
    }

    const state = await getBotCreationState(redis, context.from.id);
    if (!state || state.chatId !== context.chat.id) {
      return;
    }

    await context.deleteMessage().catch(() => undefined);
    const { preference } = await syncPlatformUser(
      prisma,
      context.from,
      platformBotId,
    );
    const token = context.message.text.trim();

    const updateCreationMessage = async (view: DashboardView) => {
      await context.api.editMessageText(
        state.chatId,
        state.dashboardMessageId,
        view.text,
        { reply_markup: view.keyboard },
      );
    };

    if (!isBotTokenFormatValid(token)) {
      await updateCreationMessage(
        buildBotTokenPrompt(
          preference.language,
          "botCreation.invalidFormat",
        ),
      );
      return;
    }

    try {
      const createdBot = await runtimeManager.createUserBot({
        ownerId: state.ownerId,
        token,
        botType: state.botType,
      });
      await clearBotCreationState(redis, context.from.id);
      await updateCreationMessage(
        buildBotCreationSuccess(
          preference.language,
          createdBot.botUsername,
        ),
      );
    } catch (error) {
      const messageKey =
        error instanceof InvalidBotTokenError
          ? "botCreation.invalidToken"
          : error instanceof BotAlreadyRegisteredError
            ? "botCreation.alreadyRegistered"
            : "botCreation.failed";
      await updateCreationMessage(
        buildBotTokenPrompt(preference.language, messageKey),
      );
    }
  });
}

export async function createPlatformBotRuntime(
  env: Env,
  prisma: PrismaClient,
  runtimeManager: BotRuntimeManager,
  redis: Redis,
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

  registerPlatformHandlers(
    bot,
    prisma,
    botRecord.id,
    runtimeManager,
    redis,
  );
  return { bot, botRecord };
}
