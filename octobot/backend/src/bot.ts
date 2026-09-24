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
  buildChannelBotSelection,
  buildChannelLinkPrompt,
  buildChannelLinkSuccess,
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
  clearDashboardState,
  getDashboardState,
  saveDashboardState,
} from "./modules/bots/dashboard-state.js";
import {
  clearChannelLinkState,
  getChannelLinkState,
  saveChannelLinkState,
} from "./modules/channels/channel-link-state.js";
import {
  BotAdminRequiredError,
  ChannelNotFoundError,
  ChannelOwnerRequiredError,
  verifyAndLinkChannel,
} from "./modules/channels/channel.service.js";
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
  redis: Redis,
  view: DashboardView,
): Promise<void> {
  await context.editMessageText(view.text, {
    reply_markup: view.keyboard,
  });

  const message = context.callbackQuery?.message;
  if (context.from && context.chat && message) {
    await saveDashboardState(redis, context.from.id, {
      chatId: context.chat.id,
      messageId: message.message_id,
    });
  }
}

function isMessageNotModified(error: unknown): boolean {
  return (
    error instanceof Error &&
    error.message.toLowerCase().includes("message is not modified")
  );
}

async function clearActiveFlow(
  redis: Redis,
  telegramUserId: number,
): Promise<void> {
  await Promise.all([
    clearBotCreationState(redis, telegramUserId),
    clearChannelLinkState(redis, telegramUserId),
  ]);
}

function registerPlatformHandlers(
  bot: TelegramBot,
  prisma: PrismaClient,
  platformBotId: string,
  runtimeManager: BotRuntimeManager,
  redis: Redis,
): void {
  const showHomeFromCommand = async (context: Context) => {
    if (!context.from) {
      return;
    }

    if (context.chat?.type !== "private") {
      await context.reply(
        translate(
          normalizeTelegramLanguage(context.from.language_code),
          "errors.privateOnly",
        ),
      );
      return;
    }

    const creationState = await getBotCreationState(
      redis,
      context.from.id,
    );
    const channelState = await getChannelLinkState(
      redis,
      context.from.id,
    );
    await clearActiveFlow(redis, context.from.id);
    const { preference } = await syncPlatformUser(
      prisma,
      context.from,
      platformBotId,
    );
    const view = buildMainMenu(preference.language);
    const dashboard =
      (await getDashboardState(redis, context.from.id)) ??
      (creationState
        ? {
            chatId: creationState.chatId,
            messageId: creationState.dashboardMessageId,
          }
        : channelState
          ? {
              chatId: channelState.chatId,
              messageId: channelState.dashboardMessageId,
            }
          : null);

    if (dashboard?.chatId === context.chat.id) {
      await context.deleteMessage().catch(() => undefined);
      try {
        await context.api.editMessageText(
          dashboard.chatId,
          dashboard.messageId,
          view.text,
          { reply_markup: view.keyboard },
        );
        await saveDashboardState(redis, context.from.id, dashboard);
        return;
      } catch (error) {
        if (isMessageNotModified(error)) {
          return;
        }
        await clearDashboardState(redis, context.from.id);
      }
    }

    const message = await context.reply(view.text, {
      reply_markup: view.keyboard,
    });
    await saveDashboardState(redis, context.from.id, {
      chatId: context.chat.id,
      messageId: message.message_id,
    });
  };

  bot.command("start", showHomeFromCommand);
  bot.command("cancel", showHomeFromCommand);

  bot.callbackQuery("menu:home", async (context) => {
    await clearActiveFlow(redis, context.from.id);
    const { preference } = await syncPlatformUser(
      prisma,
      context.from,
      platformBotId,
    );
    await editDashboard(
      context,
      redis,
      buildMainMenu(preference.language),
    );
    await context.answerCallbackQuery();
  });

  bot.callbackQuery("language:select", async (context) => {
    await clearActiveFlow(redis, context.from.id);
    const { preference } = await syncPlatformUser(
      prisma,
      context.from,
      platformBotId,
    );
    await editDashboard(
      context,
      redis,
      buildLanguageMenu(preference.language),
    );
    await context.answerCallbackQuery();
  });

  bot.callbackQuery("menu:create-bot", async (context) => {
    await clearActiveFlow(redis, context.from.id);
    const { preference } = await syncPlatformUser(
      prisma,
      context.from,
      platformBotId,
    );
    await editDashboard(
      context,
      redis,
      buildBotTypeMenu(preference.language),
    );
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
      await clearActiveFlow(redis, context.from.id);
      await saveBotCreationState(redis, context.from.id, {
        ownerId: user.id,
        botType,
        chatId: context.chat.id,
        dashboardMessageId: message.message_id,
      });
      await editDashboard(
        context,
        redis,
        buildBotTokenPrompt(preference.language),
      );
      await context.answerCallbackQuery();
    },
  );

  bot.callbackQuery("bot:create:cancel", async (context) => {
    await clearActiveFlow(redis, context.from.id);
    const { preference } = await syncPlatformUser(
      prisma,
      context.from,
      platformBotId,
    );
    await editDashboard(
      context,
      redis,
      buildMainMenu(preference.language),
    );
    await context.answerCallbackQuery();
  });

  bot.callbackQuery("menu:add-channel", async (context) => {
    await clearActiveFlow(redis, context.from.id);
    const { user, preference } = await syncPlatformUser(
      prisma,
      context.from,
      platformBotId,
    );
    const bots = await prisma.bot.findMany({
      where: {
        ownerId: user.id,
        isActive: true,
        deletedAt: null,
      },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        botUsername: true,
        botType: true,
      },
    });
    await editDashboard(
      context,
      redis,
      buildChannelBotSelection(preference.language, bots),
    );
    await context.answerCallbackQuery();
  });

  bot.callbackQuery(/^channel:bot:(.+)$/, async (context) => {
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
    const selectedBot = await prisma.bot.findFirst({
      where: {
        id: context.match[1],
        ownerId: user.id,
        isActive: true,
        deletedAt: null,
      },
    });
    if (!selectedBot || !runtimeManager.get(selectedBot.id)) {
      await editDashboard(
        context,
        redis,
        buildChannelLinkPrompt(
          preference.language,
          "channelLink.failed",
        ),
      );
      await context.answerCallbackQuery();
      return;
    }

    await clearActiveFlow(redis, context.from.id);
    await saveChannelLinkState(redis, context.from.id, {
      ownerId: user.id,
      botId: selectedBot.id,
      chatId: context.chat.id,
      dashboardMessageId: message.message_id,
    });
    await editDashboard(
      context,
      redis,
      buildChannelLinkPrompt(preference.language),
    );
    await context.answerCallbackQuery();
  });

  bot.callbackQuery("channel:cancel", async (context) => {
    await clearActiveFlow(redis, context.from.id);
    const { preference } = await syncPlatformUser(
      prisma,
      context.from,
      platformBotId,
    );
    await editDashboard(
      context,
      redis,
      buildMainMenu(preference.language),
    );
    await context.answerCallbackQuery();
  });

  bot.callbackQuery(/^language:set:(AR|EN)$/, async (context) => {
    await clearActiveFlow(redis, context.from.id);
    const { user } = await syncPlatformUser(
      prisma,
      context.from,
      platformBotId,
    );
    const language = context.match[1] as SupportedLanguage;
    await setExplicitLanguage(prisma, user.id, platformBotId, language);
    await editDashboard(context, redis, buildMainMenu(language));
    await context.answerCallbackQuery();
  });

  bot.callbackQuery(
    /^menu:(my-bots|my-channels|ads|wallet|help)$/,
    async (context) => {
      await clearActiveFlow(redis, context.from.id);
      const { preference } = await syncPlatformUser(
        prisma,
        context.from,
        platformBotId,
      );
      await editDashboard(
        context,
        redis,
        buildComingSoonMenu(preference.language),
      );
      await context.answerCallbackQuery();
    },
  );

  bot.on("message", async (context) => {
    if (!context.from || context.chat.type !== "private") {
      return;
    }

    const { preference } = await syncPlatformUser(
      prisma,
      context.from,
      platformBotId,
    );

    const creationState = await getBotCreationState(
      redis,
      context.from.id,
    );
    if (creationState?.chatId === context.chat.id) {
      await context.deleteMessage().catch(() => undefined);
      const updateCreationMessage = async (view: DashboardView) => {
        await context.api.editMessageText(
          creationState.chatId,
          creationState.dashboardMessageId,
          view.text,
          { reply_markup: view.keyboard },
        );
        await saveDashboardState(redis, context.from.id, {
          chatId: creationState.chatId,
          messageId: creationState.dashboardMessageId,
        });
      };
      const token = context.message.text?.trim() ?? "";

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
          ownerId: creationState.ownerId,
          token,
          botType: creationState.botType,
        });
        await clearActiveFlow(redis, context.from.id);
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
      return;
    }

    const channelState = await getChannelLinkState(
      redis,
      context.from.id,
    );
    if (!channelState || channelState.chatId !== context.chat.id) {
      return;
    }

    await context.deleteMessage().catch(() => undefined);
    const updateChannelMessage = async (view: DashboardView) => {
      await context.api.editMessageText(
        channelState.chatId,
        channelState.dashboardMessageId,
        view.text,
        { reply_markup: view.keyboard },
      );
      await saveDashboardState(redis, context.from.id, {
        chatId: channelState.chatId,
        messageId: channelState.dashboardMessageId,
      });
    };

    const forwardOrigin = context.message.forward_origin;
    const text = context.message.text?.trim();
    const chatReference =
      forwardOrigin?.type === "channel"
        ? forwardOrigin.chat.id
        : text && /^@[A-Za-z0-9_]{5,}$/.test(text)
          ? text
          : null;
    const selectedRuntime = runtimeManager.get(channelState.botId);

    if (!chatReference || !selectedRuntime) {
      await updateChannelMessage(
        buildChannelLinkPrompt(
          preference.language,
          "channelLink.notFound",
        ),
      );
      return;
    }

    try {
      const result = await verifyAndLinkChannel({
        prisma,
        telegramBot: selectedRuntime.bot,
        databaseBot: selectedRuntime.botRecord,
        ownerId: channelState.ownerId,
        ownerTelegramId: context.from.id,
        chatReference,
      });
      await clearActiveFlow(redis, context.from.id);
      await updateChannelMessage(
        buildChannelLinkSuccess(
          preference.language,
          result.channel.title ??
            result.channel.username ??
            result.channel.channelTelegramId.toString(),
        ),
      );
    } catch (error) {
      const messageKey =
        error instanceof ChannelOwnerRequiredError
          ? "channelLink.ownerRequired"
          : error instanceof BotAdminRequiredError
            ? "channelLink.botAdminRequired"
            : error instanceof ChannelNotFoundError
              ? "channelLink.notFound"
              : "channelLink.failed";
      await updateChannelMessage(
        buildChannelLinkPrompt(preference.language, messageKey),
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
