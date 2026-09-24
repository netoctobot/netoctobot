import { createHmac } from "node:crypto";
import {
  BotType,
  LinkStatus,
  type Bot as DatabaseBot,
  type PrismaClient,
} from "@prisma/client";
import { Bot as TelegramBot } from "grammy";
import type { Env } from "../../config/env.js";
import {
  decryptToken,
  encryptToken,
} from "../../lib/token-crypto.js";
import {
  normalizeTelegramLanguage,
  translate,
} from "../localization/localization.service.js";
import {
  BotAdminRequiredError,
  ChannelNotFoundError,
  ChannelOwnerRequiredError,
  verifyAndLinkChannel,
} from "../channels/channel.service.js";

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

function localizedWelcome(record: DatabaseBot, languageCode?: string): string {
  const messages = record.welcomeMessages as Record<string, unknown>;
  const key =
    normalizeTelegramLanguage(languageCode) === "AR" ? "ar" : "en";
  const value = messages[key];
  return typeof value === "string"
    ? value
    : "This bot is not configured yet.";
}

function registerUserBotHandlers(runtime: ManagedBotRuntime): void {
  runtime.bot.command("start", async (context) => {
    await context.reply(
      localizedWelcome(
        runtime.botRecord,
        context.from?.language_code,
      ),
    );
  });
}

export class BotRuntimeManager {
  readonly #runtimes = new Map<string, ManagedBotRuntime>();

  constructor(
    private readonly env: Env,
    private readonly prisma: PrismaClient,
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
          const channel = await this.prisma.channel.findUnique({
            where: { channelTelegramId: BigInt(context.chat.id) },
            select: { id: true },
          });
          if (channel) {
            await this.prisma.botChannelLink.updateMany({
              where: {
                botId: runtime.botRecord.id,
                channelId: channel.id,
              },
              data: { status: LinkStatus.INACTIVE },
            });
          }
        }
        return;
      }

      const actor = context.from;
      const language = normalizeTelegramLanguage(actor.language_code);
      const user = await this.prisma.user.upsert({
        where: { telegramId: BigInt(actor.id) },
        create: {
          telegramId: BigInt(actor.id),
          username: actor.username ?? null,
          firstName: actor.first_name,
          lastName: actor.last_name ?? null,
        },
        update: {
          username: actor.username ?? null,
          firstName: actor.first_name,
          lastName: actor.last_name ?? null,
          deletedAt: null,
        },
      });

      const notify = async (text: string) => {
        await runtime.bot.api
          .sendMessage(actor.id, text)
          .catch(() => undefined);
      };

      try {
        const result = await verifyAndLinkChannel({
          prisma: this.prisma,
          telegramBot: runtime.bot,
          databaseBot: runtime.botRecord,
          ownerId: user.id,
          ownerTelegramId: actor.id,
          chatReference: context.chat.id,
        });
        await notify(
          translate(language, "channelLink.success", {
            title:
              result.channel.title ??
              result.channel.username ??
              result.channel.channelTelegramId.toString(),
          }),
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
        await notify(translate(language, messageKey));
      }
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
        registerUserBotHandlers(runtime);
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
      registerUserBotHandlers(activeRuntime);
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
