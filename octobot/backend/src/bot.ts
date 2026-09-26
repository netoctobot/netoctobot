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
  buildAutomaticChannelInstructions,
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
import { resolveChannelChatReference } from "./modules/channels/channel-reference.js";
import {
  normalizeTelegramLanguage,
  translate,
} from "./modules/localization/localization.service.js";
import {
  setExplicitLanguage,
  syncBotUser,
} from "./modules/users/user.service.js";
import {
  isPrivateSlashCommand,
  PRIVATE_HOME_COMMAND_PATTERN,
} from "./modules/bots/slash-command.js";
import {
  getOwnedBot,
  listOwnedBots,
} from "./modules/bots/bot-management.service.js";
import {
  getOwnedChannel,
  listOwnedChannels,
  ManagedResourceNotFoundError,
  setOwnedChannelActive,
  softDeleteOwnedChannel,
} from "./modules/channels/channel-management.service.js";
import {
  buildBotConfirmation,
  buildChannelConfirmation,
  buildOwnedBotsMenu,
  buildOwnedChannelsMenu,
  buildPrivateChannelView,
} from "./modules/bots/management-menu.js";

export type PlatformBotRuntime = ManagedBotRuntime;

async function editDashboard(
  context: Context,
  redis: Redis,
  botId: string,
  view: DashboardView,
): Promise<void> {
  try {
    await context.editMessageText(view.text, {
      reply_markup: view.keyboard,
    });
  } catch (error) {
    if (!isMessageNotModified(error)) {
      throw error;
    }
  }

  const message = context.callbackQuery?.message;
  if (context.from && context.chat && message) {
    await saveDashboardState(redis, botId, context.from.id, {
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
  botId: string,
): Promise<void> {
  await Promise.all([
    clearBotCreationState(redis, telegramUserId),
    clearChannelLinkState(redis, botId, telegramUserId),
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
    await clearActiveFlow(redis, context.from.id, platformBotId);
    const { preference } = await syncBotUser(
      prisma,
      context.from,
      platformBotId,
    );
    const view = buildMainMenu(preference.language);
    const dashboard =
      (await getDashboardState(
        redis,
        platformBotId,
        context.from.id,
      )) ??
      (creationState
        ? {
            chatId: creationState.chatId,
            messageId: creationState.dashboardMessageId,
          }
        : null);

    if (dashboard?.chatId === context.chat.id) {
      try {
        await context.api.editMessageText(
          dashboard.chatId,
          dashboard.messageId,
          view.text,
          { reply_markup: view.keyboard },
        );
        await saveDashboardState(
          redis,
          platformBotId,
          context.from.id,
          dashboard,
        );
        await context.deleteMessage().catch(() => undefined);
        return;
      } catch (error) {
        if (!isMessageNotModified(error)) {
          await clearDashboardState(
            redis,
            platformBotId,
            context.from.id,
          );
        }
      }
    }

    const message = await context.reply(view.text, {
      reply_markup: view.keyboard,
    });
    await saveDashboardState(redis, platformBotId, context.from.id, {
      chatId: context.chat.id,
      messageId: message.message_id,
    });
  };

  const showOwnedBots = async (
    context: Context,
    page: number,
  ) => {
    const { user, preference } = await syncBotUser(
      prisma,
      context.from!,
      platformBotId,
    );
    const result = await listOwnedBots(prisma, user.id, page);
    await editDashboard(
      context,
      redis,
      platformBotId,
      buildOwnedBotsMenu(preference.language, result),
    );
    return { user, preference };
  };

  const showOwnedChannels = async (
    context: Context,
    page: number,
  ) => {
    const { user, preference } = await syncBotUser(
      prisma,
      context.from!,
      platformBotId,
    );
    const result = await listOwnedChannels(prisma, user.id, page);
    await editDashboard(
      context,
      redis,
      platformBotId,
      buildOwnedChannelsMenu(preference.language, result),
    );
    return { user, preference };
  };

  const answerManagementError = async (
    context: Context,
    language: SupportedLanguage,
    error: unknown,
  ) => {
    await context.answerCallbackQuery({
      text: translate(
        language,
        error instanceof ManagedResourceNotFoundError
          ? "management.notFound"
          : "management.actionFailed",
      ),
      show_alert: true,
    });
  };

  bot.command("start", showHomeFromCommand);
  bot.command("cancel", showHomeFromCommand);
  bot.hears(PRIVATE_HOME_COMMAND_PATTERN, showHomeFromCommand);

  bot.callbackQuery("menu:home", async (context) => {
    await clearActiveFlow(redis, context.from.id, platformBotId);
    const { preference } = await syncBotUser(
      prisma,
      context.from,
      platformBotId,
    );
    await editDashboard(
      context,
      redis,
      platformBotId,
      buildMainMenu(preference.language),
    );
    await context.answerCallbackQuery();
  });

  bot.callbackQuery("language:select", async (context) => {
    await clearActiveFlow(redis, context.from.id, platformBotId);
    const { preference } = await syncBotUser(
      prisma,
      context.from,
      platformBotId,
    );
    await editDashboard(
      context,
      redis,
      platformBotId,
      buildLanguageMenu(preference.language),
    );
    await context.answerCallbackQuery();
  });

  bot.callbackQuery("menu:create-bot", async (context) => {
    await clearActiveFlow(redis, context.from.id, platformBotId);
    const { preference } = await syncBotUser(
      prisma,
      context.from,
      platformBotId,
    );
    await editDashboard(
      context,
      redis,
      platformBotId,
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

      const { user, preference } = await syncBotUser(
        prisma,
        context.from,
        platformBotId,
      );
      const botType = context.match[1] as Extract<
        BotType,
        "CONTACT_BOT" | "SUPPORT_LIST_BOT"
      >;
      await clearActiveFlow(redis, context.from.id, platformBotId);
      await saveBotCreationState(redis, context.from.id, {
        ownerId: user.id,
        botType,
        chatId: context.chat.id,
        dashboardMessageId: message.message_id,
      });
      await editDashboard(
        context,
        redis,
        platformBotId,
        buildBotTokenPrompt(preference.language),
      );
      await context.answerCallbackQuery();
    },
  );

  bot.callbackQuery("bot:create:cancel", async (context) => {
    await clearActiveFlow(redis, context.from.id, platformBotId);
    const { preference } = await syncBotUser(
      prisma,
      context.from,
      platformBotId,
    );
    await editDashboard(
      context,
      redis,
      platformBotId,
      buildMainMenu(preference.language),
    );
    await context.answerCallbackQuery();
  });

  bot.callbackQuery("menu:add-channel", async (context) => {
    if (!context.chat) {
      await context.answerCallbackQuery();
      return;
    }
    await clearActiveFlow(redis, context.from.id, platformBotId);
    const { preference } = await syncBotUser(
      prisma,
      context.from,
      platformBotId,
    );
    await saveChannelLinkState(
      redis,
      platformBotId,
      context.from.id,
      { chatId: context.chat.id },
    );
    await editDashboard(
      context,
      redis,
      platformBotId,
      buildAutomaticChannelInstructions(
        preference.language,
        bot.botInfo.username,
      ),
    );
    await context.answerCallbackQuery();
  });

  bot.callbackQuery(/^language:set:(AR|EN)$/, async (context) => {
    await clearActiveFlow(redis, context.from.id, platformBotId);
    const { user } = await syncBotUser(
      prisma,
      context.from,
      platformBotId,
    );
    const language = context.match[1] as SupportedLanguage;
    await setExplicitLanguage(prisma, user.id, platformBotId, language);
    await editDashboard(
      context,
      redis,
      platformBotId,
      buildMainMenu(language),
    );
    await context.answerCallbackQuery();
  });

  bot.callbackQuery("menu:my-bots", async (context) => {
    await clearActiveFlow(redis, context.from.id, platformBotId);
    await showOwnedBots(context, 0);
    await context.answerCallbackQuery();
  });

  bot.callbackQuery("menu:my-channels", async (context) => {
    await clearActiveFlow(redis, context.from.id, platformBotId);
    await showOwnedChannels(context, 0);
    await context.answerCallbackQuery();
  });

  bot.callbackQuery(/^manage:b:p:(\d+)$/, async (context) => {
    await showOwnedBots(context, Number(context.match[1]));
    await context.answerCallbackQuery();
  });

  bot.callbackQuery(/^manage:c:p:(\d+)$/, async (context) => {
    await showOwnedChannels(context, Number(context.match[1]));
    await context.answerCallbackQuery();
  });

  bot.callbackQuery(
    /^manage:b:(d|x):([A-Za-z0-9_-]+):(\d+)$/,
    async (context) => {
      const { user, preference } = await syncBotUser(
        prisma,
        context.from,
        platformBotId,
      );
      try {
        const managedBot = await getOwnedBot(
          prisma,
          user.id,
          context.match[2],
        );
        await editDashboard(
          context,
          redis,
          platformBotId,
          buildBotConfirmation(
            preference.language,
            managedBot,
            context.match[1] === "d" ? "deactivate" : "delete",
            Number(context.match[3]),
          ),
        );
        await context.answerCallbackQuery();
      } catch (error) {
        await answerManagementError(
          context,
          preference.language,
          error,
        );
      }
    },
  );

  bot.callbackQuery(
    /^manage:b:a:([A-Za-z0-9_-]+):(\d+)$/,
    async (context) => {
      const { user, preference } = await syncBotUser(
        prisma,
        context.from,
        platformBotId,
      );
      try {
        await runtimeManager.activateUserBot(
          user.id,
          context.match[1],
        );
        await showOwnedBots(context, Number(context.match[2]));
        await context.answerCallbackQuery({
          text: translate(
            preference.language,
            "management.botActivated",
          ),
        });
      } catch (error) {
        await answerManagementError(
          context,
          preference.language,
          error,
        );
      }
    },
  );

  bot.callbackQuery(
    /^manage:b:(dc|xc):([A-Za-z0-9_-]+):(\d+)$/,
    async (context) => {
      const { user, preference } = await syncBotUser(
        prisma,
        context.from,
        platformBotId,
      );
      try {
        const deleted = context.match[1] === "xc";
        if (deleted) {
          await runtimeManager.softDeleteUserBot(
            user.id,
            context.match[2],
          );
        } else {
          await runtimeManager.deactivateUserBot(
            user.id,
            context.match[2],
          );
        }
        await showOwnedBots(context, Number(context.match[3]));
        await context.answerCallbackQuery({
          text: translate(
            preference.language,
            deleted
              ? "management.botDeleted"
              : "management.botDeactivated",
          ),
        });
      } catch (error) {
        await answerManagementError(
          context,
          preference.language,
          error,
        );
      }
    },
  );

  bot.callbackQuery(
    /^manage:c:(d|x):([A-Za-z0-9_-]+):(\d+)$/,
    async (context) => {
      const { user, preference } = await syncBotUser(
        prisma,
        context.from,
        platformBotId,
      );
      try {
        const channel = await getOwnedChannel(
          prisma,
          user.id,
          context.match[2],
        );
        await editDashboard(
          context,
          redis,
          platformBotId,
          buildChannelConfirmation(
            preference.language,
            channel,
            context.match[1] === "d" ? "deactivate" : "delete",
            Number(context.match[3]),
          ),
        );
        await context.answerCallbackQuery();
      } catch (error) {
        await answerManagementError(
          context,
          preference.language,
          error,
        );
      }
    },
  );

  bot.callbackQuery(
    /^manage:c:a:([A-Za-z0-9_-]+):(\d+)$/,
    async (context) => {
      const { user, preference } = await syncBotUser(
        prisma,
        context.from,
        platformBotId,
      );
      try {
        await setOwnedChannelActive(prisma, {
          ownerId: user.id,
          channelId: context.match[1],
          isActive: true,
        });
        await showOwnedChannels(context, Number(context.match[2]));
        await context.answerCallbackQuery({
          text: translate(
            preference.language,
            "management.channelActivated",
          ),
        });
      } catch (error) {
        await answerManagementError(
          context,
          preference.language,
          error,
        );
      }
    },
  );

  bot.callbackQuery(
    /^manage:c:(dc|xc):([A-Za-z0-9_-]+):(\d+)$/,
    async (context) => {
      const { user, preference } = await syncBotUser(
        prisma,
        context.from,
        platformBotId,
      );
      try {
        const deleted = context.match[1] === "xc";
        if (deleted) {
          await softDeleteOwnedChannel(prisma, {
            ownerId: user.id,
            channelId: context.match[2],
          });
        } else {
          await setOwnedChannelActive(prisma, {
            ownerId: user.id,
            channelId: context.match[2],
            isActive: false,
          });
        }
        await showOwnedChannels(context, Number(context.match[3]));
        await context.answerCallbackQuery({
          text: translate(
            preference.language,
            deleted
              ? "management.channelDeleted"
              : "management.channelDeactivated",
          ),
        });
      } catch (error) {
        await answerManagementError(
          context,
          preference.language,
          error,
        );
      }
    },
  );

  bot.callbackQuery(
    /^manage:c:v:([A-Za-z0-9_-]+):(\d+)$/,
    async (context) => {
      const { user, preference } = await syncBotUser(
        prisma,
        context.from,
        platformBotId,
      );
      try {
        const channel = await getOwnedChannel(
          prisma,
          user.id,
          context.match[1],
        );
        await editDashboard(
          context,
          redis,
          platformBotId,
          buildPrivateChannelView(
            preference.language,
            channel,
            Number(context.match[2]),
          ),
        );
        await context.answerCallbackQuery();
      } catch (error) {
        await answerManagementError(
          context,
          preference.language,
          error,
        );
      }
    },
  );

  bot.callbackQuery(
    /^menu:(ads|wallet|help)$/,
    async (context) => {
      await clearActiveFlow(redis, context.from.id, platformBotId);
      const { preference } = await syncBotUser(
        prisma,
        context.from,
        platformBotId,
      );
      await editDashboard(
        context,
        redis,
        platformBotId,
        buildComingSoonMenu(preference.language),
      );
      await context.answerCallbackQuery();
    },
  );

  bot.on("message", async (context) => {
    if (!context.from || context.chat.type !== "private") {
      return;
    }

    if (
      isPrivateSlashCommand(context.message.text, "start") ||
      isPrivateSlashCommand(context.message.text, "cancel")
    ) {
      return;
    }

    const { preference } = await syncBotUser(
      prisma,
      context.from,
      platformBotId,
    );

    const channelLinkState = await getChannelLinkState(
      redis,
      platformBotId,
      context.from.id,
    );
    if (channelLinkState?.chatId === context.chat.id) {
      await context.deleteMessage().catch(() => undefined);
      const chatReference = resolveChannelChatReference(
        context.message,
      );
      if (chatReference === null) {
        await context.reply(
          translate(preference.language, "channelLink.notFound"),
        );
        return;
      }
      const linked = await runtimeManager.linkChannelForUser({
        botId: platformBotId,
        actor: context.from,
        chatReference,
      });
      if (linked) {
        await clearChannelLinkState(
          redis,
          platformBotId,
          context.from.id,
        );
      }
      return;
    }
    if (channelLinkState) {
      await clearChannelLinkState(
        redis,
        platformBotId,
        context.from.id,
      );
    }

    const creationState = await getBotCreationState(
      redis,
      context.from.id,
    );
    if (creationState?.chatId === context.chat.id) {
      await context.deleteMessage().catch(() => undefined);
      const updateCreationMessage = async (view: DashboardView) => {
        try {
          await context.api.editMessageText(
            creationState.chatId,
            creationState.dashboardMessageId,
            view.text,
            { reply_markup: view.keyboard },
          );
        } catch (error) {
          if (!isMessageNotModified(error)) {
            throw error;
          }
        }
        await saveDashboardState(
          redis,
          platformBotId,
          context.from.id,
          {
          chatId: creationState.chatId,
          messageId: creationState.dashboardMessageId,
          },
        );
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
        await clearActiveFlow(redis, context.from.id, platformBotId);
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
  });

  bot.catch(async (error) => {
    const context = error.ctx;
    if (context.chat?.type !== "private") {
      return;
    }
    const language = normalizeTelegramLanguage(
      context.from?.language_code,
    );
    await context
      .reply(translate(language, "errors.generic"))
      .catch(() => undefined);
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
