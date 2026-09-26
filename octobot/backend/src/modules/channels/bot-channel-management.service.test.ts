import assert from "node:assert/strict";
import test from "node:test";
import {
  LinkStatus,
  type PrismaClient,
} from "@prisma/client";
import type { Bot as TelegramBot } from "grammy";
import {
  activateManagedBotChannel,
  deactivateManagedBotChannel,
  listManagedBotChannels,
  removeManagedBotChannel,
} from "./bot-channel-management.service.js";

function linkedChannel() {
  return {
    id: "link-id",
    botId: "bot-id",
    status: LinkStatus.ACTIVE,
    deactivationReason: null,
    channel: {
      id: "channel-id",
      title: "Channel",
      username: "channel_name",
      channelTelegramId: -1001234567890n,
      isActive: true,
      deletedAt: null,
    },
  };
}

test("lists channels through the current bot and owner only", async () => {
  let receivedWhere: unknown;
  const prisma = {
    botChannelLink: {
      count: async (input: { where: unknown }) => {
        receivedWhere = input.where;
        return 1;
      },
      findMany: async () => [linkedChannel()],
    },
  } as unknown as PrismaClient;

  const result = await listManagedBotChannels(
    prisma,
    "bot-id",
    "owner-id",
    0,
  );

  assert.equal(result.total, 1);
  assert.equal(result.items[0]?.id, "link-id");
  assert.deepEqual(
    (receivedWhere as { botId: string; bot: unknown }).botId,
    "bot-id",
  );
  assert.deepEqual(
    (receivedWhere as { bot: unknown }).bot,
    { ownerId: "owner-id", deletedAt: null },
  );
});

test("platform list scopes links by current bot and channel owner", async () => {
  let receivedWhere: unknown;
  const prisma = {
    botChannelLink: {
      count: async (input: { where: unknown }) => {
        receivedWhere = input.where;
        return 0;
      },
      findMany: async () => [],
    },
  } as unknown as PrismaClient;

  await listManagedBotChannels(
    prisma,
    "platform-bot",
    "channel-owner",
    0,
    "CHANNEL_OWNER",
  );

  assert.deepEqual(
    receivedWhere as {
      botId: string;
      channel: unknown;
    },
    {
      botId: "platform-bot",
      channel: {
        ownerId: "channel-owner",
        deletedAt: null,
      },
      OR: [
        { deactivationReason: null },
        {
          deactivationReason: {
            not: "OWNER_UNLINKED",
          },
        },
      ],
    },
  );
});

test("deactivate and remove change only the selected bot link", async () => {
  const updates: unknown[] = [];
  const prisma = {
    botChannelLink: {
      findFirst: async () => linkedChannel(),
      update: async (input: unknown) => {
        updates.push(input);
        return {};
      },
    },
  } as unknown as PrismaClient;

  await deactivateManagedBotChannel(
    prisma,
    "bot-id",
    "owner-id",
    "link-id",
  );
  await removeManagedBotChannel(
    prisma,
    "bot-id",
    "owner-id",
    "link-id",
  );

  assert.equal(
    (updates[0] as { data: { deactivationReason: string } })
      .data.deactivationReason,
    "OWNER_DEACTIVATED",
  );
  assert.equal(
    (updates[1] as { data: { deactivationReason: string } })
      .data.deactivationReason,
    "OWNER_UNLINKED",
  );
});

test("activation verifies Telegram permissions before restoring the link", async () => {
  const updates: unknown[] = [];
  const prisma = {
    botChannelLink: {
      findFirst: async () => ({
        ...linkedChannel(),
        status: LinkStatus.INACTIVE,
      }),
      update: async (input: unknown) => {
        updates.push(input);
        return {};
      },
    },
  } as unknown as PrismaClient;
  const telegramBot = {
    botInfo: { id: 999 },
    api: {
      getChatMember: async () => ({
        status: "administrator",
        can_post_messages: true,
        can_delete_messages: true,
      }),
    },
  } as unknown as TelegramBot;

  await activateManagedBotChannel(
    prisma,
    telegramBot,
    "bot-id",
    "owner-id",
    "link-id",
  );

  assert.equal(
    (updates[0] as { data: { status: LinkStatus } }).data.status,
    LinkStatus.ACTIVE,
  );
});
