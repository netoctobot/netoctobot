import { SupportedLanguage } from "@prisma/client";
import type { Bot as TelegramBot, Context } from "grammy";
import type { Message } from "grammy/types";
import { translate } from "../localization/localization.service.js";

const CONTACT_ID_PATTERN = /(?:^|\n)CONTACT_ID:(\d+)(?:\n|$)/;
const THUMBS_UP = { type: "emoji" as const, emoji: "👍" as const };

interface AlbumItem {
  chatId: number;
  messageId: number;
}

interface AlbumBucket {
  items: AlbumItem[];
  language: SupportedLanguage;
  targetTelegramId: number;
  timer: ReturnType<typeof setTimeout>;
}

export function buildPrivateReplyAnchor(
  language: SupportedLanguage,
  telegramUserId: number,
): string {
  return translate(language, "contact.privateReplyAnchor", {
    id: telegramUserId,
  });
}

export function resolveContactReplyTarget(
  repliedTo: Message | undefined,
  botTelegramId: number,
): number | null {
  if (!repliedTo) {
    return null;
  }
  if (
    repliedTo.forward_origin?.type === "user" &&
    !repliedTo.forward_origin.sender_user.is_bot
  ) {
    return repliedTo.forward_origin.sender_user.id;
  }
  if (repliedTo.from?.id !== botTelegramId || !repliedTo.text) {
    return null;
  }
  const match = CONTACT_ID_PATTERN.exec(repliedTo.text);
  if (!match) {
    return null;
  }
  const telegramUserId = Number(match[1]);
  return Number.isSafeInteger(telegramUserId) && telegramUserId > 0
    ? telegramUserId
    : null;
}

export class ContactBotRelay {
  readonly #visitorAlbums = new Map<string, AlbumBucket>();
  readonly #ownerAlbums = new Map<string, AlbumBucket>();

  constructor(
    private readonly bot: TelegramBot,
    private readonly ownerTelegramId: number,
    private readonly albumDelayMs = 1_000,
  ) {}

  async handleVisitorMessage(
    context: Context,
    language: SupportedLanguage,
  ): Promise<void> {
    if (!context.message || !context.from || !context.chat) {
      return;
    }
    if (context.message.media_group_id) {
      this.enqueueVisitorAlbum(context, language);
      return;
    }

    try {
      const forwarded = await context.forwardMessage(
        this.ownerTelegramId,
      );
      const origin = forwarded.forward_origin;
      if (
        origin?.type !== "user" ||
        origin.sender_user.id !== context.from.id
      ) {
        await this.bot.api.sendMessage(
          this.ownerTelegramId,
          buildPrivateReplyAnchor(language, context.from.id),
        );
      }
      await context.react(THUMBS_UP).catch(() => undefined);
    } catch {
      await context
        .reply(translate(language, "contact.deliveryFailed"))
        .catch(() => undefined);
    }
  }

  async handleOwnerMessage(
    context: Context,
    language: SupportedLanguage,
  ): Promise<void> {
    if (!context.message || !context.chat) {
      return;
    }
    if (context.message.media_group_id) {
      this.enqueueOwnerAlbum(context, language);
      return;
    }

    const targetTelegramId = resolveContactReplyTarget(
      context.message.reply_to_message,
      this.bot.botInfo.id,
    );
    if (targetTelegramId === null) {
      await context.reply(
        translate(language, "contact.replyRequired"),
      );
      return;
    }

    try {
      await context.copyMessage(targetTelegramId);
      await context.react(THUMBS_UP).catch(() => undefined);
    } catch {
      await context
        .reply(translate(language, "contact.replyFailed"))
        .catch(() => undefined);
    }
  }

  private enqueueVisitorAlbum(
    context: Context,
    language: SupportedLanguage,
  ): void {
    const message = context.message!;
    const from = context.from!;
    const chat = context.chat!;
    const key = `${chat.id}:${message.media_group_id!}`;
    const existing = this.#visitorAlbums.get(key);
    if (existing) {
      existing.items.push({
        chatId: chat.id,
        messageId: message.message_id,
      });
      return;
    }

    const bucket: AlbumBucket = {
      items: [{ chatId: chat.id, messageId: message.message_id }],
      language,
      targetTelegramId: from.id,
      timer: setTimeout(() => {
        void this.flushVisitorAlbum(key);
      }, this.albumDelayMs),
    };
    this.#visitorAlbums.set(key, bucket);
  }

  private async flushVisitorAlbum(key: string): Promise<void> {
    const bucket = this.#visitorAlbums.get(key);
    if (!bucket) {
      return;
    }
    this.#visitorAlbums.delete(key);
    clearTimeout(bucket.timer);
    const items = bucket.items.sort(
      (left, right) => left.messageId - right.messageId,
    );
    try {
      await this.bot.api.forwardMessages(
        this.ownerTelegramId,
        items[0]!.chatId,
        items.map((item) => item.messageId),
      );
      await this.bot.api.sendMessage(
        this.ownerTelegramId,
        buildPrivateReplyAnchor(
          bucket.language,
          bucket.targetTelegramId,
        ),
      );
      await Promise.all(
        items.map((item) =>
          this.bot.api
            .setMessageReaction(
              item.chatId,
              item.messageId,
              [THUMBS_UP],
            )
            .catch(() => undefined),
        ),
      );
    } catch {
      await this.bot.api
        .sendMessage(
          bucket.targetTelegramId,
          translate(bucket.language, "contact.deliveryFailed"),
        )
        .catch(() => undefined);
    }
  }

  private enqueueOwnerAlbum(
    context: Context,
    language: SupportedLanguage,
  ): void {
    const message = context.message!;
    const chat = context.chat!;
    const key = `${chat.id}:${message.media_group_id!}`;
    const existing = this.#ownerAlbums.get(key);
    if (existing) {
      existing.items.push({
        chatId: chat.id,
        messageId: message.message_id,
      });
      return;
    }

    const targetTelegramId = resolveContactReplyTarget(
      message.reply_to_message,
      this.bot.botInfo.id,
    );
    if (targetTelegramId === null) {
      void context.reply(
        translate(language, "contact.replyRequired"),
      );
      return;
    }

    const bucket: AlbumBucket = {
      items: [{ chatId: chat.id, messageId: message.message_id }],
      language,
      targetTelegramId,
      timer: setTimeout(() => {
        void this.flushOwnerAlbum(key);
      }, this.albumDelayMs),
    };
    this.#ownerAlbums.set(key, bucket);
  }

  private async flushOwnerAlbum(key: string): Promise<void> {
    const bucket = this.#ownerAlbums.get(key);
    if (!bucket) {
      return;
    }
    this.#ownerAlbums.delete(key);
    clearTimeout(bucket.timer);
    const items = bucket.items.sort(
      (left, right) => left.messageId - right.messageId,
    );
    try {
      await this.bot.api.copyMessages(
        bucket.targetTelegramId,
        items[0]!.chatId,
        items.map((item) => item.messageId),
      );
      await Promise.all(
        items.map((item) =>
          this.bot.api
            .setMessageReaction(
              item.chatId,
              item.messageId,
              [THUMBS_UP],
            )
            .catch(() => undefined),
        ),
      );
    } catch {
      await this.bot.api
        .sendMessage(
          this.ownerTelegramId,
          translate(bucket.language, "contact.replyFailed"),
        )
        .catch(() => undefined);
    }
  }
}
