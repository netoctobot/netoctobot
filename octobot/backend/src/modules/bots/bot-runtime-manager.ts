import { createHmac } from "node:crypto";
import {
  BotType,
  LinkStatus,
  type Bot as DatabaseBot,
  type PrismaClient,
  type SupportedLanguage,
} from "@prisma/client";
import { Bot as TelegramBot, type Context } from "grammy";
import type { Redis } from "ioredis";
import type { Env } from "../../config/env.js";
import {
  decryptToken,
  encryptToken,
} from "../../lib/token-crypto.js";
import {
  translate,
  type TranslationKey,
} from "../localization/localization.service.js";
import {
  BotAdminRequiredError,
  ChannelNotFoundError,
  ChannelOwnerRequiredError,
  BotPermissionsRequiredError,
  verifyAndLinkChannel,
} from "../channels/channel.service.js";
import {
  clearChannelLinkState,
  getChannelLinkState,
  saveChannelLinkState,
} from "../channels/channel-link-state.js";
import { resolveChannelChatReference } from "../channels/channel-reference.js";
import {
  getDashboardState,
  saveDashboardState,
} from "./dashboard-state.js";
import {
  buildMainMenu,
  type DashboardView,
} from "./platform-menu.js";
import {
  buildManualChannelLinkPrompt,
  buildSubBotHome,
  CANCEL_MANUAL_CHANNEL_LINK,
  START_MANUAL_CHANNEL_LINK,
} from "./sub-bot-menu.js";
import { syncBotUser } from "../users/user.service.js";

export interface ManagedBotRuntime {
  bot: TelegramBot;
  botRecord: DatabaseBot;
}

export class InvalidBotTokenError extends Error {
  constructor() {
    super("Telegram rejected the bot token");
    this.name = "InvalidBotTokenError";
  }
}

export class BotAlreadyRegisteredError extends Error {
  constructor() {
    super("This Telegram bot is already registered");
    this.name = "BotAlreadyRegisteredError";
  }
}

export function isBotTokenFormatValid(token: string): boolean {
  return /^\d{8,12}:[A-Za-z0-9_-]{30,}$/.test(token);
}

export function deriveWebhookSecret(
  masterSecret: string,
  botId: string,
): string {
  return createHmac("sha256", masterSecret).update(botId).digest("hex");
}

function defaultMessages(botType: BotType): {
  welcomeMessages: { ar: string; en: string };
  footerTexts: { ar: string; en: string };
} {
  if (botType === BotType.SUPPORT_LIST_BOT) {
    return {
      welcomeMessages: {
        ar: "بوت قائمة الدعم قيد التجهيز.",
        en: "The support-list bot is under construction.",
      },
      footerTexts: {
        ar: "تم الإنشاء بواسطة أوكتوبوت",
        en: "Created with Octobot",
      },
    };
  }

  return {
    welcomeMessages: {
      ar: "أرسل رسالتك وسيتم إيصالها إلى مالك البوت.",
      en: "Send your message and it will be delivered to the bot owner.",
    },
    footerTexts: {
      ar: "تم الإنشاء بواسطة أوكتوبوت",
      en: "Created with Octobot",
    },
  };
}

export class BotRuntimeManager {
  readonly #runtimes = new Map<string, ManagedBotRuntime>();

  constructor(
    private readonly env: Env,
    private readonly prisma: PrismaClient,
    private readonly redis: Redis,
  ) {}

  add(runtime: ManagedBotRuntime): void {
    if (!this.#runtimes.has(runtime.botRecord.id)) {
      this.registerChannelMembershipHandler(runtime);
    }
    this.#runtimes.set(runtime.botRecord.id, runtime);
  }

  get(botId: string): ManagedBotRuntime | undefined {
    return this.#runtimes.get(botId);
  }

  private buildHome(
    record: DatabaseBot,
    language: SupportedLanguage,
  ): DashboardView {
    return record.botType === BotType.PLATFORM_BOT
      ? buildMainMenu(language)
      : buildSubBotHome(record, language);
  }

  private isMessageNotModified(error: unknown): boolean {
    return (
      error instanceof Error &&
      error.message.toLowerCase().includes("message is not modified")
    );
  }

  private registerUserBotHandlers(runtime: ManagedBotRuntime): void {
    const showHome = async (context: Context) => {
      if (!context.from || context.chat?.type !== "private") {
        return;
      }

      await clearChannelLinkState(
        this.redis,
        runtime.botRecord.id,
        context.from.id,
      );
      const { preference } = await syncBotUser(
        this.prisma,
        context.from,
        runtime.botRecord.id,
      );
      const view = this.buildHome(
        runtime.botRecord,
        preference.language,
      );
      const dashboard = await getDashboardState(
        this.redis,
        runtime.botRecord.id,
        context.from.id,
      );

      if (dashboard?.chatId === context.chat.id) {
        await context.deleteMessage().catch(() => undefined);
        try {
          await context.api.editMessageText(
            dashboard.chatId,
            dashboard.messageId,
            view.text,
            { reply_markup: view.keyboard },
          );
          return;
        } catch (error) {
          if (this.isMessageNotModified(error)) {
            return;
          }
        }
      }

      const message = await context.reply(view.text, {
        reply_markup: view.keyboard,
      });
      await saveDashboardState(
        this.redis,
        runtime.botRecord.id,
        context.from.id,
        {
          chatId: context.chat.id,
          messageId: message.message_id,
        },
      );
    };

    runtime.bot.command("start", showHome);
    runtime.bot.command("cancel", showHome);

    runtime.bot.callbackQuery(
      START_MANUAL_CHANNEL_LINK,
      async (context) => {
        if (!context.from || context.chat?.type !== "private") {
          return;
        }

        const { preference } = await syncBotUser(
          this.prisma,
          context.from,
          runtime.botRecord.id,
        );
        await saveChannelLinkState(
          this.redis,
          runtime.botRecord.id,
          context.from.id,
          { chatId: context.chat.id },
        );
        await context.answerCallbackQuery();

        const view = buildManualChannelLinkPrompt(
          preference.language,
        );
        try {
          await context.editMessageText(view.text, {
            reply_markup: view.keyboard,
          });
        } catch (error) {
          if (!this.isMessageNotModified(error)) {
            throw error;
          }
        }
      },
    );

    runtime.bot.callbackQuery(
      CANCEL_MANUAL_CHANNEL_LINK,
      async (context) => {
        if (!context.from || context.chat?.type !== "private") {
          return;
        }

        await clearChannelLinkState(
          this.redis,
          runtime.botRecord.id,
          context.from.id,
        );
        const { preference } = await syncBotUser(
          this.prisma,
          context.from,
          runtime.botRecord.id,
        );
        await context.answerCallbackQuery();

        const view = this.buildHome(
          runtime.botRecord,
          preference.language,
        );
        try {
          await context.editMessageText(view.text, {
            reply_markup: view.keyboard,
          });
        } catch (error) {
          if (!this.isMessageNotModified(error)) {
            throw error;
          }
        }
      },
    );

    runtime.bot.on("message", async (context) => {
      if (!context.from || context.chat.type !== "private") {
        return;
      }

      const state = await getChannelLinkState(
        this.redis,
        runtime.botRecord.id,
        context.from.id,
      );
      if (!state) {
        return;
      }
      if (state.chatId !== context.chat.id) {
        await clearChannelLinkState(
          this.redis,
          runtime.botRecord.id,
          context.from.id,
        );
        return;
      }

      const { user, preference } = await syncBotUser(
        this.prisma,
        context.from,
        runtime.botRecord.id,
      );
      const chatReference = resolveChannelChatReference(
        context.message,
      );
      if (chatReference === null) {
        await context.reply(
          translate(preference.language, "channelLink.notFound"),
        );
        return;
      }

      const linked = await this.attemptChannelLink({
        runtime,
        ownerId: user.id,
        ownerTelegramId: context.from.id,
        language: preference.language,
        chatReference,
      });
      if (linked) {
        await clearChannelLinkState(
          this.redis,
          runtime.botRecord.id,
          context.from.id,
        );
      }
    });
  }

  private async deactivateChannelLink(
    botId: string,
    channelTelegramId: number,
  ): Promise<void> {
    const channel = await this.prisma.channel.findUnique({
      where: { channelTelegramId: BigInt(channelTelegramId) },
      select: { id: true },
    });
    if (!channel) {
      return;
    }
    await this.prisma.botChannelLink.updateMany({
      where: { botId, channelId: channel.id },
      data: { status: LinkStatus.INACTIVE },
    });
  }

  private channelLinkErrorKey(error: unknown): TranslationKey {
    return error instanceof ChannelOwnerRequiredError
      ? "channelLink.ownerRequired"
      : error instanceof BotAdminRequiredError
        ? "channelLink.botAdminRequired"
        : error instanceof BotPermissionsRequiredError
          ? "channelLink.requiredPermissions"
          : error instanceof ChannelNotFoundError
            ? "channelLink.notFound"
            : "channelLink.failed";
  }

  private async attemptChannelLink(input: {
    runtime: ManagedBotRuntime;
    ownerId: string;
    ownerTelegramId: number;
    language: SupportedLanguage;
    chatReference: number | string;
    deactivateChannelId?: number;
  }): Promise<boolean> {
    try {
      const result = await verifyAndLinkChannel({
        prisma: this.prisma,
        telegramBot: input.runtime.bot,
        databaseBot: input.runtime.botRecord,
        ownerId: input.ownerId,
        ownerTelegramId: input.ownerTelegramId,
        chatReference: input.chatReference,
      });
      await this.showTemporarySuccess({
        runtime: input.runtime,
        telegramUserId: input.ownerTelegramId,
        language: input.language,
        text: translate(input.language, "channelLink.success", {
          title:
            result.channel.title ??
            result.channel.username ??
            result.channel.channelTelegramId.toString(),
        }),
      });
      return true;
    } catch (error) {
      if (
        input.deactivateChannelId !== undefined &&
        (error instanceof BotAdminRequiredError ||
          error instanceof BotPermissionsRequiredError)
      ) {
        await this.deactivateChannelLink(
          input.runtime.botRecord.id,
          input.deactivateChannelId,
        );
      }
      if (
        !(error instanceof ChannelOwnerRequiredError) &&
        !(error instanceof BotAdminRequiredError) &&
        !(error instanceof BotPermissionsRequiredError) &&
        !(error instanceof ChannelNotFoundError)
      ) {
        console.error(
          `Failed to link a channel to bot ${input.runtime.botRecord.id}`,
        );
      }
      await input.runtime.bot.api
        .sendMessage(
          input.ownerTelegramId,
          translate(
            input.language,
            this.channelLinkErrorKey(error),
          ),
        )
        .catch(() => undefined);
      return false;
    }
  }

  private async showTemporarySuccess(input: {
    runtime: ManagedBotRuntime;
    telegramUserId: number;
    language: SupportedLanguage;
    text: string;
  }): Promise<void> {
    const confirmation = await input.runtime.bot.api
      .sendMessage(input.telegramUserId, input.text)
      .catch(() => null);
    const dashboard = await getDashboardState(
      this.redis,
      input.runtime.botRecord.id,
      input.telegramUserId,
    );

    const timer = setTimeout(() => {
      void (async () => {
        if (confirmation) {
          await input.runtime.bot.api
            .deleteMessage(
              confirmation.chat.id,
              confirmation.message_id,
            )
            .catch(() => undefined);
        }
        if (!dashboard) {
          return;
        }

        const home = this.buildHome(
          input.runtime.botRecord,
          input.language,
        );
        try {
          await input.runtime.bot.api.editMessageText(
            dashboard.chatId,
            dashboard.messageId,
            home.text,
            { reply_markup: home.keyboard },
          );
        } catch (error) {
          if (!this.isMessageNotModified(error)) {
            console.error(
              `Failed to restore bot dashboard ${input.runtime.botRecord.id}`,
            );
          }
        }
      })();
    }, 5_000);
    timer.unref();
  }

  private registerChannelMembershipHandler(
    runtime: ManagedBotRuntime,
  ): void {
    runtime.bot.on("my_chat_member", async (context) => {
      if (context.chat.type !== "channel") {
        return;
      }

      const newStatus = context.myChatMember.new_chat_member.status;
      const wasLinked =
        context.myChatMember.old_chat_member.status === "administrator" ||
        context.myChatMember.old_chat_member.status === "creator";
      const isNowAdmin =
        newStatus === "administrator" || newStatus === "creator";

      if (!isNowAdmin) {
        if (wasLinked) {
          await this.deactivateChannelLink(
            runtime.botRecord.id,
            context.chat.id,
          );
        }
        return;
      }

      const actor = context.from;
      const { user, preference } = await syncBotUser(
        this.prisma,
        actor,
        runtime.botRecord.id,
      );
      await this.attemptChannelLink({
        runtime,
        ownerId: user.id,
        ownerTelegramId: actor.id,
        language: preference.language,
        chatReference: context.chat.id,
        deactivateChannelId: context.chat.id,
      });
    });
  }

  async loadActiveUserBots(): Promise<void> {
    const records = await this.prisma.bot.findMany({
      where: {
        isActive: true,
        deletedAt: null,
        botType: { not: BotType.PLATFORM_BOT },
      },
    });

    for (const record of records) {
      try {
        const token = decryptToken(
          record.tokenEncrypted,
          this.env.ENCRYPTION_KEY,
        );
        const bot = new TelegramBot(token);
        await bot.init();
        const runtime = { bot, botRecord: record };
        this.registerUserBotHandlers(runtime);
        this.add(runtime);
      } catch (error) {
        const reason =
          error instanceof Error ? error.message : "Unknown runtime error";
        console.error(
          `Failed to load bot runtime ${record.id} (@${record.botUsername}): ${reason}`,
        );
      }
    }
  }

  async registerAllWebhooks(): Promise<void> {
    for (const runtime of this.#runtimes.values()) {
      await this.registerWebhook(runtime);
    }
  }

  async createUserBot(input: {
    ownerId: string;
    token: string;
    botType: Extract<BotType, "CONTACT_BOT" | "SUPPORT_LIST_BOT">;
  }): Promise<DatabaseBot> {
    if (!isBotTokenFormatValid(input.token)) {
      throw new InvalidBotTokenError();
    }

    const bot = new TelegramBot(input.token);
    try {
      await bot.init();
    } catch {
      throw new InvalidBotTokenError();
    }

    const telegramBotId = BigInt(bot.botInfo.id);
    const existing = await this.prisma.bot.findUnique({
      where: { telegramBotId },
    });

    if (
      existing &&
      (existing.ownerId !== input.ownerId ||
        existing.isActive ||
        existing.botType === BotType.PLATFORM_BOT)
    ) {
      throw new BotAlreadyRegisteredError();
    }

    const messages = defaultMessages(input.botType);
    const encryptedToken = encryptToken(
      input.token,
      this.env.ENCRYPTION_KEY,
    );

    const pendingRecord = existing
      ? await this.prisma.bot.update({
          where: { id: existing.id },
          data: {
            tokenEncrypted: encryptedToken,
            encryptionKeyVersion: 1,
            botUsername: bot.botInfo.username,
            botType: input.botType,
            welcomeMessages: messages.welcomeMessages,
            footerTexts: messages.footerTexts,
            isActive: false,
            deletedAt: null,
          },
        })
      : await this.prisma.bot.create({
          data: {
            ownerId: input.ownerId,
            telegramBotId,
            tokenEncrypted: encryptedToken,
            botUsername: bot.botInfo.username,
            botType: input.botType,
            welcomeMessages: messages.welcomeMessages,
            footerTexts: messages.footerTexts,
            isActive: false,
          },
        });

    const runtime = { bot, botRecord: pendingRecord };

    try {
      await this.registerWebhook(runtime);
      const activeRecord = await this.prisma.$transaction(
        async (transaction) => {
          const activated = await transaction.bot.update({
            where: { id: pendingRecord.id },
            data: { isActive: true },
          });
          await transaction.wallet.upsert({
            where: { userId: input.ownerId },
            create: { userId: input.ownerId },
            update: {},
          });
          return activated;
        },
      );

      const activeRuntime = { bot, botRecord: activeRecord };
      this.registerUserBotHandlers(activeRuntime);
      this.add(activeRuntime);
      return activeRecord;
    } catch (error) {
      await this.prisma.bot.update({
        where: { id: pendingRecord.id },
        data: { isActive: false },
      });
      throw error;
    }
  }

  async registerWebhook(runtime: ManagedBotRuntime): Promise<void> {
    if (!this.env.WEBHOOK_REGISTRATION_ENABLED) {
      return;
    }

    const baseUrl = this.env.PUBLIC_BASE_URL.endsWith("/")
      ? this.env.PUBLIC_BASE_URL
      : `${this.env.PUBLIC_BASE_URL}/`;
    const webhookUrl = new URL(
      `webhooks/telegram/${runtime.botRecord.id}`,
      baseUrl,
    ).toString();

    await runtime.bot.api.setWebhook(webhookUrl, {
      secret_token: deriveWebhookSecret(
        this.env.WEBHOOK_SECRET,
        runtime.botRecord.id,
      ),
      allowed_updates: [
        "message",
        "callback_query",
        "my_chat_member",
      ],
    });
  }
}
