import { createHmac } from "node:crypto";
import {
  BotType,
  type Bot as DatabaseBot,
  type PrismaClient,
} from "@prisma/client";
import { Bot as TelegramBot } from "grammy";
import type { Env } from "../../config/env.js";
import {
  decryptToken,
  encryptToken,
} from "../../lib/token-crypto.js";
import { normalizeTelegramLanguage } from "../localization/localization.service.js";

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
    this.#runtimes.set(runtime.botRecord.id, runtime);
  }

  get(botId: string): ManagedBotRuntime | undefined {
    return this.#runtimes.get(botId);
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
      allowed_updates: ["message", "callback_query"],
    });
  }
}
