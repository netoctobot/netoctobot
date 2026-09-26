import assert from "node:assert/strict";
import test from "node:test";
import { LinkStatus, type PrismaClient } from "@prisma/client";
import type { Bot as TelegramBot } from "grammy";
import type { ChatMember } from "grammy/types";
import { reconcileBotLinksForActivation } from "./bot-link-activation.service.js";

test("activation preserves valid links and restores legacy temporary deactivations", async () => {
  const updates: Array<{
    where: { id: string };
    data: Record<string, unknown>;
  }> = [];
  const links = [
    {
      id: "active-link",
      status: LinkStatus.ACTIVE,
      deactivationReason: null,
      channel: { channelTelegramId: -1000000000001n },
    },
    {
      id: "legacy-paused-link",
      status: LinkStatus.INACTIVE,
      deactivationReason: "BOT_DEACTIVATED",
      channel: { channelTelegramId: -1000000000002n },
    },
  ];
  const transaction = {
    botChannelLink: {
      update: async (input: (typeof updates)[number]) => {
        updates.push(input);
        return {};
      },
    },
  };
  const prisma = {
    botChannelLink: { findMany: async () => links },
    $transaction: async (
      callback: (client: typeof transaction) => Promise<void>,
    ) => callback(transaction),
  } as unknown as PrismaClient;
  const telegramBot = {
    botInfo: { id: 999 },
    api: {
      getChatMember: async () =>
        ({
          status: "administrator",
          can_post_messages: true,
          can_delete_messages: true,
        }) as ChatMember,
    },
  } as unknown as TelegramBot;

  const result = await reconcileBotLinksForActivation(
    prisma,
    telegramBot,
    "bot-id",
  );

  assert.deepEqual(result, {
    verified: 2,
    restored: 1,
    deactivated: 0,
  });
  assert.deepEqual(updates, [
    {
      where: { id: "legacy-paused-link" },
      data: {
        status: LinkStatus.ACTIVE,
        deactivatedAt: null,
        deactivationReason: null,
      },
    },
  ]);
});

test("activation inactivates only links that lost Telegram permissions", async () => {
  const updates: Array<{
    where: { id: string };
    data: Record<string, unknown>;
  }> = [];
  const transaction = {
    botChannelLink: {
      update: async (input: (typeof updates)[number]) => {
        updates.push(input);
        return {};
      },
    },
  };
  const prisma = {
    botChannelLink: {
      findMany: async () => [
        {
          id: "permission-lost-link",
          status: LinkStatus.ACTIVE,
          deactivationReason: null,
          channel: { channelTelegramId: -1000000000001n },
        },
      ],
    },
    $transaction: async (
      callback: (client: typeof transaction) => Promise<void>,
    ) => callback(transaction),
  } as unknown as PrismaClient;
  const telegramBot = {
    botInfo: { id: 999 },
    api: {
      getChatMember: async () =>
        ({
          status: "administrator",
          can_post_messages: true,
          can_delete_messages: false,
        }) as ChatMember,
    },
  } as unknown as TelegramBot;

  const result = await reconcileBotLinksForActivation(
    prisma,
    telegramBot,
    "bot-id",
  );

  assert.deepEqual(result, {
    verified: 1,
    restored: 0,
    deactivated: 1,
  });
  assert.equal(updates[0]?.where.id, "permission-lost-link");
  assert.equal(
    updates[0]?.data.deactivationReason,
    "PERMISSIONS_LOST",
  );
  assert.equal(updates[0]?.data.status, LinkStatus.INACTIVE);
  assert.ok(updates[0]?.data.deactivatedAt instanceof Date);
});
