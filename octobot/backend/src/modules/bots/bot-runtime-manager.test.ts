import assert from "node:assert/strict";
import test from "node:test";
import {
  BotType,
  type Bot,
  type PrismaClient,
} from "@prisma/client";
import type { Redis } from "ioredis";
import {
  InlineKeyboard,
  type Bot as TelegramBot,
  type Context,
} from "grammy";
import type { Env } from "../../config/env.js";
import {
  BotRuntimeManager,
  deriveWebhookSecret,
  isBotTokenFormatValid,
} from "./bot-runtime-manager.js";

test("validates Telegram bot token shape without logging the token", () => {
  assert.equal(
    isBotTokenFormatValid(
      "1234567890:abcdefghijklmnopqrstuvwxyzABCDE_12345",
    ),
    true,
  );
  assert.equal(isBotTokenFormatValid("not-a-token"), false);
});

test("derives stable bot-specific webhook secrets", () => {
  const first = deriveWebhookSecret("master-secret", "bot-a");
  const repeated = deriveWebhookSecret("master-secret", "bot-a");
  const otherBot = deriveWebhookSecret("master-secret", "bot-b");

  assert.equal(first, repeated);
  assert.notEqual(first, otherBot);
  assert.match(first, /^[a-f0-9]{64}$/);
});

function lifecycleManager() {
  const record = {
    id: "bot-id",
    ownerId: "owner-id",
    botType: BotType.CONTACT_BOT,
    deletedAt: null,
    isActive: true,
  } as Bot;
  const botUpdates: unknown[] = [];
  const linkUpdates: unknown[] = [];
  const audits: unknown[] = [];
  const transaction = {
    bot: {
      update: async (value: unknown) => {
        botUpdates.push(value);
        return { ...record, isActive: false };
      },
    },
    botChannelLink: {
      updateMany: async (value: unknown) => {
        linkUpdates.push(value);
        return { count: 1 };
      },
    },
    auditLog: {
      create: async (value: unknown) => {
        audits.push(value);
        return {};
      },
    },
  };
  const prisma = {
    bot: {
      findFirst: async () => record,
    },
    $transaction: async (
      callback: (value: typeof transaction) => unknown,
    ) => callback(transaction),
  } as unknown as PrismaClient;
  const env = {
    WEBHOOK_REGISTRATION_ENABLED: false,
  } as Env;
  return {
    manager: new BotRuntimeManager(
      env,
      prisma,
      {} as Redis,
    ),
    record,
    botUpdates,
    linkUpdates,
    audits,
  };
}

test("temporarily deactivates the runtime without changing channel links", async () => {
  const value = lifecycleManager();
  let running = false;
  value.manager.add({
    bot: {
      on: () => undefined,
      isRunning: () => running,
      start: async () => {
        running = true;
      },
      stop: async () => {
        running = false;
      },
    } as unknown as TelegramBot,
    botRecord: value.record,
  });

  await value.manager.deactivateUserBot("owner-id", "bot-id");

  assert.equal(
    value.manager.get("bot-id")?.botRecord.isActive,
    false,
  );
  assert.deepEqual(value.botUpdates[0], {
    where: { id: "bot-id" },
    data: { isActive: false, deletedAt: null },
  });
  assert.equal(value.linkUpdates.length, 0);
  assert.equal(running, true);
});

test("soft-deletes a bot without deleting its historical row", async () => {
  const value = lifecycleManager();

  await value.manager.softDeleteUserBot("owner-id", "bot-id");

  const update = value.botUpdates[0] as {
    data: { isActive: boolean; deletedAt: Date };
  };
  assert.equal(update.data.isActive, false);
  assert.ok(update.data.deletedAt instanceof Date);
  const linkUpdate = value.linkUpdates[0] as {
    data: { deactivationReason: string };
  };
  assert.equal(
    linkUpdate.data.deactivationReason,
    "BOT_DELETED",
  );
  assert.equal(value.audits.length, 1);
});

test("recreates a dashboard when Telegram says the hidden old message is unchanged", async () => {
  const redisValues = new Map<string, string>([
    [
      "bot:dashboard:bot-id:123",
      JSON.stringify({ chatId: 123, messageId: 55 }),
    ],
  ]);
  const redis = {
    get: async (key: string) => redisValues.get(key) ?? null,
    set: async (key: string, value: string) => {
      redisValues.set(key, value);
      return "OK";
    },
    del: async (key: string) => {
      redisValues.delete(key);
      return 1;
    },
  } as unknown as Redis;
  const manager = new BotRuntimeManager(
    { WEBHOOK_REGISTRATION_ENABLED: true } as Env,
    {} as PrismaClient,
    redis,
  );
  const deletedMessageIds: number[] = [];
  let replies = 0;
  const context = {
    from: { id: 123, is_bot: false, first_name: "Owner" },
    chat: { id: 123, type: "private" },
    api: {
      editMessageText: async () => {
        throw new Error("Bad Request: message is not modified");
      },
      deleteMessage: async (_chatId: number, messageId: number) => {
        deletedMessageIds.push(messageId);
        return true;
      },
    },
    reply: async () => {
      replies += 1;
      return {
        message_id: 77,
        chat: { id: 123, type: "private" },
        date: 1,
      };
    },
    deleteMessage: async () => true,
  } as unknown as Context;
  const runtime = {
    bot: {} as TelegramBot,
    botRecord: { id: "bot-id" } as Bot,
  };
  const dashboardManager = manager as unknown as {
    showRuntimeDashboard(
      context: Context,
      runtime: typeof runtime,
      view: { text: string; keyboard: InlineKeyboard },
    ): Promise<void>;
  };

  await dashboardManager.showRuntimeDashboard(
    context,
    runtime,
    {
      text: "Owner panel",
      keyboard: new InlineKeyboard(),
    },
  );

  assert.equal(replies, 1);
  assert.deepEqual(deletedMessageIds, [55]);
  assert.deepEqual(
    JSON.parse(
      redisValues.get("bot:dashboard:bot-id:123") ?? "{}",
    ),
    { chatId: 123, messageId: 77 },
  );
});
