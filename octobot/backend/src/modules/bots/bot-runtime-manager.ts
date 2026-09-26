import { createHmac } from "node:crypto";
import {
  BotType,
  LinkStatus,
  SupportedLanguage,
  type Bot as DatabaseBot,
  type PrismaClient,
} from "@prisma/client";
import { Bot as TelegramBot, type Context } from "grammy";
import type { User as TelegramUser } from "grammy/types";
import type { Redis } from "ioredis";
import type { Env } from "../../config/env.js";
import {
  decryptToken,
  encryptToken,
} from "../../lib/token-crypto.js";
import {
  normalizeTelegramLanguage,
  translate,
  type TranslationKey,
} from "../localization/localization.service.js";
import {
  isPrivateSlashCommand,
  PRIVATE_HOME_COMMAND_PATTERN,
} from "./slash-command.js";
import { reconcileBotLinksForActivation } from "./bot-link-activation.service.js";
import { ContactBotRelay } from "./contact-bot.service.js";
import {
  BotAdminRequiredError,
  deactivateBotChannelLink,
  ExplicitRelinkRequiredError,
  getBotChannelLinkSnapshot,
  type LinkDeactivationReason,
  ChannelNotFoundError,
  ChannelAdministratorRequiredError,
  BotPermissionsRequiredError,
  verifyAndLinkChannel,
} from "../channels/channel.service.js";
import {
  clearChannelLinkState,
  getChannelLinkState,
  saveChannelLinkState,
} from "../channels/channel-link-state.js";
import { resolveChannelChatReference } from "../channels/channel-reference.js";
import { ManagedResourceNotFoundError } from "../channels/channel-management.service.js";
import { classifyChannelMembership } from "../channels/channel-membership.js";
import {
  clearDashboardState,
  getDashboardState,
  saveDashboardState,
} from "./dashboard-state.js";
import {
  buildMainMenu,
  type DashboardView,
} from "./platform-menu.js";
import {
  buildContactVisitorWelcome,
  buildDisabledContactView,
  buildSubBotHome,
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
  readonly #contactRelays = new Map<string, ContactBotRelay>();
  readonly #ownerTelegramIds = new Map<string, number>();

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

  private async getOwnerTelegramId(
    record: DatabaseBot,
  ): Promise<number> {
    const cached = this.#ownerTelegramIds.get(record.id);
    if (cached !== undefined) {
      return cached;
    }
    const owner = await this.prisma.user.findUniqueOrThrow({
      where: { id: record.ownerId },
      select: { telegramId: true },
    });
    const telegramId = Number(owner.telegramId);
    this.#ownerTelegramIds.set(record.id, telegramId);
    return telegramId;
  }

  private async getContactRelay(
    runtime: ManagedBotRuntime,
  ): Promise<ContactBotRelay> {
    const cached = this.#contactRelays.get(runtime.botRecord.id);
    if (cached) {
      return cached;
    }
    const relay = new ContactBotRelay(
      runtime.bot,
      await this.getOwnerTelegramId(runtime.botRecord),
    );
    this.#contactRelays.set(runtime.botRecord.id, relay);
    return relay;
  }

  private getPlatformBotUsername(): string {
    for (const runtime of this.#runtimes.values()) {
      if (runtime.botRecord.botType === BotType.PLATFORM_BOT) {
        return runtime.botRecord.botUsername;
      }
    }
    throw new Error("Platform bot runtime is unavailable");
  }

  private async replyContactDisabled(
    context: Context,
  ): Promise<void> {
    const language = normalizeTelegramLanguage(
      context.from?.language_code,
    );
    const view = buildDisabledContactView(
      language,
      this.getPlatformBotUsername(),
    );
    await context.reply(view.text, { reply_markup: view.keyboard });
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

      if (runtime.botRecord.botType === BotType.CONTACT_BOT) {
        if (!runtime.botRecord.isActive) {
          await this.replyContactDisabled(context);
          return;
        }
        const ownerTelegramId = await this.getOwnerTelegramId(
          runtime.botRecord,
        );
        if (context.from.id !== ownerTelegramId) {
          await clearChannelLinkState(
            this.redis,
            runtime.botRecord.id,
            context.from.id,
          );
          await context.reply(
            buildContactVisitorWelcome(
              runtime.botRecord,
              normalizeTelegramLanguage(
                context.from.language_code,
              ),
            ),
          );
          return;
        }
      }

      await saveChannelLinkState(
        this.redis,
        runtime.botRecord.id,
        context.from.id,
        { chatId: context.chat.id },
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
        try {
          await context.api.editMessageText(
            dashboard.chatId,
            dashboard.messageId,
            view.text,
            { reply_markup: view.keyboard },
          );
          await context.deleteMessage().catch(() => undefined);
          return;
        } catch (error) {
          if (!this.isMessageNotModified(error)) {
            await clearDashboardState(
              this.redis,
              runtime.botRecord.id,
              context.from.id,
            );
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
    runtime.bot.hears(PRIVATE_HOME_COMMAND_PATTERN, showHome);

    runtime.bot.on("message", async (context) => {
      if (!context.from || context.chat.type !== "private") {
        return;
      }

      if (
        isPrivateSlashCommand(context.message.text, "start") ||
        isPrivateSlashCommand(context.message.text, "cancel")
      ) {
        return;
      }

      let contactRelay: ContactBotRelay | null = null;
      let isContactOwner = false;
      if (runtime.botRecord.botType === BotType.CONTACT_BOT) {
        if (!runtime.botRecord.isActive) {
          await this.replyContactDisabled(context);
          return;
        }
        const ownerTelegramId = await this.getOwnerTelegramId(
          runtime.botRecord,
        );
        contactRelay = await this.getContactRelay(runtime);
        isContactOwner = context.from.id === ownerTelegramId;
        const language = normalizeTelegramLanguage(
          context.from.language_code,
        );
        if (!isContactOwner) {
          await contactRelay.handleVisitorMessage(
            context,
            language,
          );
          return;
        }
        if (
          context.message.reply_to_message ||
          context.message.media_group_id
        ) {
          await contactRelay.handleOwnerMessage(context, language);
          return;
        }
      }

      const state = await getChannelLinkState(
        this.redis,
        runtime.botRecord.id,
        context.from.id,
      );
      if (!state) {
        if (contactRelay && isContactOwner) {
          await contactRelay.handleOwnerMessage(
            context,
            normalizeTelegramLanguage(
              context.from.language_code,
            ),
          );
        }
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

      const chatReference = resolveChannelChatReference(
        context.message,
      );
      if (chatReference === null && contactRelay && isContactOwner) {
        await contactRelay.handleOwnerMessage(
          context,
          normalizeTelegramLanguage(context.from.language_code),
        );
        return;
      }

      const { user, preference } = await syncBotUser(
        this.prisma,
        context.from,
        runtime.botRecord.id,
      );
      if (chatReference === null) {
        await context.reply(
          translate(preference.language, "channelLink.notFound"),
        );
        return;
      }

      await context.deleteMessage().catch(() => undefined);
      const linked = await this.attemptChannelLink({
        runtime,
        addedByUserId: user.id,
        addedByTelegramId: context.from.id,
        language: preference.language,
        chatReference,
        source: "MANUAL",
      });
      if (linked) {
        await clearChannelLinkState(
          this.redis,
          runtime.botRecord.id,
          context.from.id,
        );
      }
    });

    runtime.bot.catch(async (error) => {
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

  private async deactivateChannelLink(
    runtime: ManagedBotRuntime,
    channelTelegramId: number,
    reason: LinkDeactivationReason,
    notificationKey:
      | "channelLink.removed"
      | "channelLink.permissionsLost",
  ): Promise<void> {
    const link = await deactivateBotChannelLink(this.prisma, {
      botId: runtime.botRecord.id,
      channelTelegramId,
      reason,
    });
    if (!link) {
      return;
    }
    const preference = await this.prisma.userBotPreference.findUnique({
      where: {
        userId_botId: {
          userId: link.ownerUserId,
          botId: runtime.botRecord.id,
        },
      },
      select: { language: true },
    });
    await runtime.bot.api
      .sendMessage(
        link.notificationTelegramId,
        translate(
          preference?.language ?? SupportedLanguage.EN,
          notificationKey,
        ),
      )
      .catch(() => undefined);
  }

  private channelLinkErrorKey(error: unknown): TranslationKey {
    return error instanceof ChannelAdministratorRequiredError
      ? "channelLink.administratorRequired"
      : error instanceof BotAdminRequiredError
        ? "channelLink.botAdminRequired"
        : error instanceof BotPermissionsRequiredError
          ? "channelLink.requiredPermissions"
          : error instanceof ChannelNotFoundError
            ? "channelLink.notFound"
            : error instanceof ExplicitRelinkRequiredError
              ? "channelLink.relinkRequired"
              : "channelLink.failed";
  }

  private async attemptChannelLink(input: {
    runtime: ManagedBotRuntime;
    addedByUserId: string;
    addedByTelegramId: number;
    language: SupportedLanguage;
    chatReference: number | string;
    deactivateChannelId?: number;
    source: "AUTO" | "MANUAL";
  }): Promise<boolean> {
    try {
      const result = await verifyAndLinkChannel({
        prisma: this.prisma,
        telegramBot: input.runtime.bot,
        databaseBot: input.runtime.botRecord,
        addedByUserId: input.addedByUserId,
        addedByTelegramId: input.addedByTelegramId,
        chatReference: input.chatReference,
        source: input.source,
      });
      await this.showTemporarySuccess({
        runtime: input.runtime,
        telegramUserId: input.addedByTelegramId,
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
        await deactivateBotChannelLink(this.prisma, {
          botId: input.runtime.botRecord.id,
          channelTelegramId: input.deactivateChannelId,
          reason:
            error instanceof BotPermissionsRequiredError
              ? "PERMISSIONS_LOST"
              : "BOT_REMOVED",
        });
      }
      if (
        !(error instanceof ChannelAdministratorRequiredError) &&
        !(error instanceof BotAdminRequiredError) &&
        !(error instanceof BotPermissionsRequiredError) &&
        !(error instanceof ChannelNotFoundError) &&
        !(error instanceof ExplicitRelinkRequiredError)
      ) {
        console.error(
          `Failed to link a channel to bot ${input.runtime.botRecord.id}`,
        );
      }
      await input.runtime.bot.api
        .sendMessage(
          input.addedByTelegramId,
          translate(
            input.language,
            this.channelLinkErrorKey(error),
          ),
        )
        .catch(() => undefined);
      return false;
    }
  }

  async linkChannelForUser(input: {
    botId: string;
    actor: TelegramUser;
    chatReference: number | string;
  }): Promise<boolean> {
    const runtime = this.#runtimes.get(input.botId);
    if (!runtime) {
      throw new ManagedResourceNotFoundError();
    }
    const { user, preference } = await syncBotUser(
      this.prisma,
      input.actor,
      input.botId,
    );
    return this.attemptChannelLink({
      runtime,
      addedByUserId: user.id,
      addedByTelegramId: input.actor.id,
      language: preference.language,
      chatReference: input.chatReference,
      source: "MANUAL",
    });
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
      if (
        runtime.botRecord.botType === BotType.CONTACT_BOT &&
        !runtime.botRecord.isActive
      ) {
        return;
      }

      const membership = context.myChatMember.new_chat_member;
      const membershipOutcome =
        classifyChannelMembership(membership);
      if (membershipOutcome !== "VALID") {
        const permissionsLost =
          membershipOutcome === "PERMISSIONS_LOST";
        await this.deactivateChannelLink(
          runtime,
          context.chat.id,
          membershipOutcome,
          permissionsLost
            ? "channelLink.permissionsLost"
            : "channelLink.removed",
        );
        return;
      }

      const existingLink = await getBotChannelLinkSnapshot(
        this.prisma,
        {
          botId: runtime.botRecord.id,
          channelTelegramId: context.chat.id,
        },
      );
      if (existingLink) {
        if (existingLink.status === LinkStatus.INACTIVE) {
          const preference =
            await this.prisma.userBotPreference.findUnique({
              where: {
                userId_botId: {
                  userId: existingLink.ownerUserId,
                  botId: runtime.botRecord.id,
                },
              },
              select: { language: true },
            });
          await runtime.bot.api
            .sendMessage(
              existingLink.notificationTelegramId,
              translate(
                preference?.language ?? SupportedLanguage.EN,
                "channelLink.relinkRequired",
              ),
            )
            .catch(() => undefined);
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
        addedByUserId: user.id,
        addedByTelegramId: actor.id,
        language: preference.language,
        chatReference: context.chat.id,
        deactivateChannelId: context.chat.id,
        source: "AUTO",
      });
    });
  }

  async activateUserBot(
    ownerId: string,
    botId: string,
  ): Promise<DatabaseBot> {
    const record = await this.prisma.bot.findFirst({
      where: {
        id: botId,
        ownerId,
        deletedAt: null,
        botType: { not: BotType.PLATFORM_BOT },
      },
    });
    if (!record) {
      throw new ManagedResourceNotFoundError();
    }
    const existingRuntime = this.#runtimes.get(record.id);
    if (record.isActive && existingRuntime) {
      return record;
    }

    const persistActivation = () =>
      this.prisma.$transaction(async (transaction) => {
        const activated = await transaction.bot.update({
          where: { id: record.id },
          data: { isActive: true },
        });
        await transaction.auditLog.create({
          data: {
            userId: ownerId,
            action: "BOT_ACTIVATED",
            entityType: "Bot",
            entityId: record.id,
          },
        });
        return activated;
      });

    if (
      existingRuntime &&
      record.botType === BotType.CONTACT_BOT
    ) {
      await reconcileBotLinksForActivation(
        this.prisma,
        existingRuntime.bot,
        record.id,
      );
      const activeRecord = await persistActivation();
      existingRuntime.botRecord = activeRecord;
      return activeRecord;
    }

    const token = decryptToken(
      record.tokenEncrypted,
      this.env.ENCRYPTION_KEY,
    );
    const bot = new TelegramBot(token);
    await bot.init();
    const pendingRuntime = { bot, botRecord: record };
    await reconcileBotLinksForActivation(
      this.prisma,
      bot,
      record.id,
    );
    await this.registerWebhook(pendingRuntime);

    let activeRecord: DatabaseBot;
    try {
      activeRecord = await persistActivation();
    } catch (error) {
      await this.unregisterWebhook(pendingRuntime);
      throw error;
    }

    const runtime = { bot, botRecord: activeRecord };
    this.registerUserBotHandlers(runtime);
    this.add(runtime);
    return activeRecord;
  }

  async deactivateUserBot(
    ownerId: string,
    botId: string,
  ): Promise<void> {
    await this.stopUserBot(ownerId, botId, false);
  }

  async softDeleteUserBot(
    ownerId: string,
    botId: string,
  ): Promise<void> {
    await this.stopUserBot(ownerId, botId, true);
  }

  private async stopUserBot(
    ownerId: string,
    botId: string,
    deleted: boolean,
  ): Promise<void> {
    const record = await this.prisma.bot.findFirst({
      where: {
        id: botId,
        ownerId,
        deletedAt: null,
        botType: { not: BotType.PLATFORM_BOT },
      },
    });
    if (!record) {
      throw new ManagedResourceNotFoundError();
    }

    const runtime = this.#runtimes.get(record.id);
    const keepDormant =
      !deleted &&
      record.botType === BotType.CONTACT_BOT &&
      runtime !== undefined;
    if (!keepDormant) {
      this.#runtimes.delete(record.id);
    }
    const deactivatedAt = new Date();
    let updatedRecord: DatabaseBot;
    try {
      updatedRecord = await this.prisma.$transaction(
        async (transaction) => {
          const updated = await transaction.bot.update({
            where: { id: record.id },
            data: {
              isActive: false,
              deletedAt: deleted ? deactivatedAt : null,
            },
          });
          if (deleted) {
            await transaction.botChannelLink.updateMany({
              where: { botId: record.id },
              data: {
                status: LinkStatus.INACTIVE,
                deactivatedAt,
                deactivationReason: "BOT_DELETED",
              },
            });
          }
          await transaction.auditLog.create({
            data: {
              userId: ownerId,
              action: deleted
                ? "BOT_SOFT_DELETED"
                : "BOT_DEACTIVATED",
              entityType: "Bot",
              entityId: record.id,
            },
          });
          return updated;
        },
      );
    } catch (error) {
      if (runtime && !keepDormant) {
        this.#runtimes.set(record.id, runtime);
      }
      throw error;
    }

    if (keepDormant) {
      runtime.botRecord = updatedRecord;
    } else if (runtime) {
      await this.unregisterWebhook(runtime);
    }
    if (deleted) {
      this.#contactRelays.delete(record.id);
      this.#ownerTelegramIds.delete(record.id);
    }
  }

  async loadActiveUserBots(): Promise<void> {
    const records = await this.prisma.bot.findMany({
      where: {
        deletedAt: null,
        botType: { not: BotType.PLATFORM_BOT },
        OR: [
          { isActive: true },
          { botType: BotType.CONTACT_BOT },
        ],
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

  private async unregisterWebhook(
    runtime: ManagedBotRuntime,
  ): Promise<void> {
    if (!this.env.WEBHOOK_REGISTRATION_ENABLED) {
      return;
    }
    await runtime.bot.api
      .deleteWebhook({ drop_pending_updates: false })
      .catch((error: unknown) => {
        const reason =
          error instanceof Error ? error.message : "Unknown error";
        console.error(
          `Failed to delete webhook for bot ${runtime.botRecord.id}: ${reason}`,
        );
      });
  }
}
