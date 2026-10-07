import { SupportedLanguage, type PrismaClient } from "@prisma/client";
import { type Bot, type Context, InlineKeyboard } from "grammy";
import type { Redis } from "ioredis";
import {
  normalizeTelegramLanguage,
  translate,
} from "../localization/localization.service.js";
import {
  classifyMembershipError,
  isSubscribedStatus,
  isSubscriptionExempt,
} from "./membership.js";

const PENDING_TTL_SECONDS = 30 * 60;
const OK_TTL_SECONDS = 45;

export interface GateMemberApi {
  getChatMember(
    chatId: number,
    userId: number,
  ): Promise<{ status: string; is_member?: boolean }>;
}

export type PendingIntent =
  | { kind: "callback"; data: string }
  | { kind: "text"; text: string }
  | { kind: "unreplayable" };

type GateChannel = {
  title: string | null;
  username: string | null;
  telegramId: string;
  joinUrl: string | null;
};

export type GateDecision =
  | { kind: "pass" }
  | { kind: "retry" }
  | { kind: "missing"; channels: GateChannel[] };

function pendingKey(botId: string, telegramUserId: number): string {
  return `forced-sub:pending:${botId}:${telegramUserId}`;
}

function okKey(telegramUserId: number): string {
  return `forced-sub:ok:${telegramUserId}`;
}

export function joinButtonUrl(channel: {
  username: string | null;
  joinUrl: string | null;
}): string | null {
  if (channel.joinUrl) {
    return channel.joinUrl;
  }
  if (!channel.username) {
    return null;
  }
  return `https://t.me/${channel.username.replace(/^@/, "")}`;
}

export function subscriptionKeyboard(
  language: SupportedLanguage,
  channels: GateChannel[],
): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  for (const channel of channels) {
    const url = joinButtonUrl(channel);
    const label = channel.title || channel.username || translate(language, "subscription.join");
    if (url) {
      keyboard.url(label.slice(0, 64), url).row();
    }
  }
  keyboard.text(translate(language, "subscription.check"), "forced:check");
  return keyboard;
}

export function subscriptionText(
  language: SupportedLanguage,
  channels: GateChannel[],
): string {
  const names = channels
    .map((channel) => channel.title || channel.username || channel.telegramId)
    .join("\n");
  return `${translate(language, "subscription.required")}\n${names}`;
}

async function loadActiveChannels(prisma: PrismaClient): Promise<GateChannel[]> {
  const rows = await prisma.platformForcedChannel.findMany({
    where: { isActive: true },
    orderBy: { sortOrder: "asc" },
    select: {
      joinUrl: true,
      channel: {
        select: { title: true, username: true, channelTelegramId: true },
      },
    },
  });
  return rows.map((row) => ({
    title: row.channel.title,
    username: row.channel.username,
    telegramId: row.channel.channelTelegramId.toString(),
    joinUrl: row.joinUrl,
  }));
}

export async function evaluateSubscription(
  prisma: PrismaClient,
  redis: Redis,
  api: GateMemberApi,
  telegramUserId: number,
  fresh: boolean,
): Promise<GateDecision> {
  if (!fresh && (await redis.get(okKey(telegramUserId)))) {
    return { kind: "pass" };
  }
  const channels = await loadActiveChannels(prisma);
  if (channels.length === 0) {
    return { kind: "pass" };
  }
  const missing: GateChannel[] = [];
  for (const channel of channels) {
    try {
      const member = await api.getChatMember(Number(channel.telegramId), telegramUserId);
      if (!isSubscribedStatus(member.status, member.is_member)) {
        missing.push(channel);
      }
    } catch (error) {
      if (classifyMembershipError(error) === "unavailable") {
        return { kind: "retry" };
      }
      missing.push(channel);
    }
  }
  if (missing.length === 0) {
    await redis.set(okKey(telegramUserId), "1", "EX", OK_TTL_SECONDS);
    return { kind: "pass" };
  }
  return { kind: "missing", channels: missing };
}

export async function savePendingIntent(
  redis: Redis,
  botId: string,
  telegramUserId: number,
  intent: PendingIntent,
): Promise<void> {
  await redis.set(
    pendingKey(botId, telegramUserId),
    JSON.stringify(intent),
    "EX",
    PENDING_TTL_SECONDS,
  );
}

export async function takePendingIntent(
  redis: Redis,
  botId: string,
  telegramUserId: number,
): Promise<PendingIntent | null> {
  const key = pendingKey(botId, telegramUserId);
  const raw = await redis.get(key);
  await redis.del(key);
  if (!raw) {
    return null;
  }
  const parsed = JSON.parse(raw) as PendingIntent;
  if (
    parsed.kind === "unreplayable" ||
    (parsed.kind === "callback" && typeof parsed.data === "string") ||
    (parsed.kind === "text" && typeof parsed.text === "string")
  ) {
    return parsed;
  }
  return null;
}

export async function clearSubscriptionCache(
  redis: Redis,
  telegramUserId: number,
): Promise<void> {
  await redis.del(okKey(telegramUserId));
}

export function intentFromUpdate(input: {
  callbackData?: string;
  text?: string;
}): PendingIntent {
  if (input.callbackData && !isSubscriptionExempt(input.callbackData)) {
    return { kind: "callback", data: input.callbackData };
  }
  if (input.text && input.text.length <= 4096) {
    return { kind: "text", text: input.text };
  }
  return { kind: "unreplayable" };
}

export function gateLanguage(languageCode: string | undefined): SupportedLanguage {
  return normalizeTelegramLanguage(languageCode);
}

async function replyGate(
  context: Context,
  language: SupportedLanguage,
  decision: Exclude<GateDecision, { kind: "pass" }>,
): Promise<void> {
  if (decision.kind === "retry") {
    await context.reply(translate(language, "subscription.retry")).catch(() => undefined);
  } else {
    await context
      .reply(subscriptionText(language, decision.channels), {
        reply_markup: subscriptionKeyboard(language, decision.channels),
      })
      .catch(() => undefined);
  }
  if (context.callbackQuery) {
    await context.answerCallbackQuery().catch(() => undefined);
  }
}

export function attachSubscriptionGate(
  bot: Bot,
  input: {
    prisma: PrismaClient;
    redis: Redis;
    api: GateMemberApi;
    botId: () => string;
    bypass: () => boolean;
  },
): void {
  bot.use(async (context, next) => {
    if (context.chat?.type !== "private" || !context.from || input.bypass()) {
      await next();
      return;
    }
    if (isSubscriptionExempt(context.callbackQuery?.data)) {
      await next();
      return;
    }
    const decision = await evaluateSubscription(
      input.prisma,
      input.redis,
      input.api,
      context.from.id,
      false,
    );
    if (decision.kind === "pass") {
      await next();
      return;
    }
    const language = gateLanguage(context.from.language_code);
    if (decision.kind === "missing") {
      await savePendingIntent(
        input.redis,
        input.botId(),
        context.from.id,
        intentFromUpdate({
          callbackData: context.callbackQuery?.data,
          text: context.message?.text,
        }),
      );
    }
    await replyGate(context, language, decision);
  });

  bot.callbackQuery("forced:check", async (context) => {
    if (!context.from || !context.chat) {
      return;
    }
    await clearSubscriptionCache(input.redis, context.from.id);
    const decision = await evaluateSubscription(
      input.prisma,
      input.redis,
      input.api,
      context.from.id,
      true,
    );
    const language = gateLanguage(context.from.language_code);
    if (decision.kind !== "pass") {
      await replyGate(context, language, decision);
      return;
    }
    await context.answerCallbackQuery().catch(() => undefined);
    const pending = await takePendingIntent(input.redis, input.botId(), context.from.id);
    if (!pending || pending.kind === "unreplayable") {
      await context.reply(translate(language, "subscription.ready")).catch(() => undefined);
      return;
    }
    const updateId = Date.now();
    if (pending.kind === "text") {
      await bot.handleUpdate({
        update_id: updateId,
        message: {
          message_id: updateId,
          date: Math.floor(updateId / 1000),
          chat: { id: context.chat.id, type: "private", first_name: context.from.first_name },
          from: context.from,
          text: pending.text,
        },
      });
      return;
    }
    await bot.handleUpdate({
      update_id: updateId,
      callback_query: {
        id: `resume-${updateId}`,
        from: context.from,
        chat_instance: "resume",
        data: pending.data,
        message: context.callbackQuery?.message,
      },
    });
  });
}
