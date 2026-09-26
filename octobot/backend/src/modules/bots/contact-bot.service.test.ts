import assert from "node:assert/strict";
import test from "node:test";
import { SupportedLanguage } from "@prisma/client";
import type { Bot as TelegramBot, Context } from "grammy";
import type { Message } from "grammy/types";
import {
  buildPrivateReplyAnchor,
  ContactBotRelay,
  resolveContactReplyTarget,
} from "./contact-bot.service.js";

const botInfo = {
  id: 999,
  is_bot: true as const,
  first_name: "Contact",
  username: "contact_bot",
  can_join_groups: true,
  can_read_all_group_messages: false,
  supports_inline_queries: false,
};

test("resolves visible forwards and bot-authored privacy anchors without storage", () => {
  assert.equal(
    resolveContactReplyTarget(
      {
        forward_origin: {
          type: "user",
          sender_user: {
            id: 123,
            is_bot: false,
            first_name: "Visitor",
          },
          date: 1,
        },
      } as Message,
      botInfo.id,
    ),
    123,
  );

  const anchor = buildPrivateReplyAnchor(
    SupportedLanguage.EN,
    456,
  );
  assert.equal(
    resolveContactReplyTarget(
      {
        from: botInfo,
        text: anchor,
      } as Message,
      botInfo.id,
    ),
    456,
  );
  assert.equal(
    resolveContactReplyTarget(
      {
        from: { id: 1, is_bot: false, first_name: "Fake" },
        text: anchor,
      } as Message,
      botInfo.id,
    ),
    null,
  );
});

test("forwards a visitor message and reacts only after delivery", async () => {
  const sent: Array<{ chatId: number; text: string }> = [];
  const reactions: unknown[] = [];
  const replies: string[] = [];
  const bot = {
    botInfo,
    api: {
      sendMessage: async (chatId: number, text: string) => {
        sent.push({ chatId, text });
        return {};
      },
    },
  } as unknown as TelegramBot;
  const relay = new ContactBotRelay(bot, 777);
  const context = {
    from: { id: 123, is_bot: false, first_name: "Visitor" },
    chat: { id: 123, type: "private" },
    message: { message_id: 10, date: 1 },
    forwardMessage: async () =>
      ({
        forward_origin: {
          type: "hidden_user",
          sender_user_name: "Visitor",
          date: 1,
        },
      }) as Message,
    react: async (reaction: unknown) => {
      reactions.push(reaction);
      return true;
    },
    reply: async (text: string) => {
      replies.push(text);
      return {};
    },
  } as unknown as Context;

  await relay.handleVisitorMessage(context, SupportedLanguage.EN);

  assert.equal(sent.length, 1);
  assert.equal(sent[0]?.chatId, 777);
  assert.match(sent[0]?.text ?? "", /CONTACT_ID:123/);
  assert.equal(reactions.length, 1);
  assert.equal(replies.length, 0);
});

test("reports visitor delivery failure without a success reaction", async () => {
  const reactions: unknown[] = [];
  const replies: string[] = [];
  const relay = new ContactBotRelay(
    { botInfo, api: {} } as unknown as TelegramBot,
    777,
  );
  const context = {
    from: { id: 123, is_bot: false, first_name: "Visitor" },
    chat: { id: 123, type: "private" },
    message: { message_id: 10, date: 1 },
    forwardMessage: async () => {
      throw new Error("delivery failed");
    },
    react: async (reaction: unknown) => {
      reactions.push(reaction);
      return true;
    },
    reply: async (text: string) => {
      replies.push(text);
      return {};
    },
  } as unknown as Context;

  await relay.handleVisitorMessage(context, SupportedLanguage.EN);

  assert.equal(reactions.length, 0);
  assert.equal(replies.length, 1);
  assert.match(replies[0] ?? "", /could not be delivered/);
});

test("copies an owner reply to hide owner identity and reacts on success", async () => {
  const copies: number[] = [];
  const reactions: unknown[] = [];
  const relay = new ContactBotRelay(
    { botInfo, api: {} } as unknown as TelegramBot,
    777,
  );
  const context = {
    chat: { id: 777, type: "private" },
    message: {
      message_id: 20,
      date: 1,
      reply_to_message: {
        forward_origin: {
          type: "user",
          sender_user: {
            id: 123,
            is_bot: false,
            first_name: "Visitor",
          },
          date: 1,
        },
      },
    },
    copyMessage: async (chatId: number) => {
      copies.push(chatId);
      return { message_id: 21 };
    },
    react: async (reaction: unknown) => {
      reactions.push(reaction);
      return true;
    },
  } as unknown as Context;

  await relay.handleOwnerMessage(context, SupportedLanguage.EN);

  assert.deepEqual(copies, [123]);
  assert.equal(reactions.length, 1);
});

test("forwards an album once in message order using only memory", async () => {
  const batches: number[][] = [];
  const anchors: string[] = [];
  const reactions: number[] = [];
  const bot = {
    botInfo,
    api: {
      forwardMessages: async (
        _target: number,
        _source: number,
        messageIds: number[],
      ) => {
        batches.push(messageIds);
        return messageIds.map((message_id) => ({ message_id }));
      },
      sendMessage: async (_chatId: number, text: string) => {
        anchors.push(text);
        return {};
      },
      setMessageReaction: async (
        _chatId: number,
        messageId: number,
      ) => {
        reactions.push(messageId);
        return true;
      },
    },
  } as unknown as TelegramBot;
  const relay = new ContactBotRelay(bot, 777, 0);
  const context = (messageId: number) =>
    ({
      from: { id: 123, is_bot: false, first_name: "Visitor" },
      chat: { id: 123, type: "private" },
      message: {
        message_id: messageId,
        date: 1,
        media_group_id: "album",
      },
    }) as unknown as Context;

  await relay.handleVisitorMessage(
    context(11),
    SupportedLanguage.EN,
  );
  await relay.handleVisitorMessage(
    context(10),
    SupportedLanguage.EN,
  );
  await new Promise((resolve) => setTimeout(resolve, 10));

  assert.deepEqual(batches, [[10, 11]]);
  assert.equal(anchors.length, 1);
  assert.deepEqual(reactions.sort(), [10, 11]);
});
