import assert from "node:assert/strict";
import test from "node:test";
import {
  LinkStatus,
  type PrismaClient,
} from "@prisma/client";
import type { Bot as TelegramBot } from "grammy";
import { BotAdminRequiredError } from "./channel.service.js";
import {
  activateManagedBotChannel,
  deactivateManagedBotChannel,
  INVITE_LINK_PERMISSION_LOST,
  InviteLinkPermissionRequiredError,
  listManagedBotChannels,
  openManagedBotChannel,
  reconcilePrivateInvitePermission,
  removeManagedBotChannel,
  TelegramApiUnavailableError,
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
      getChat: async () => ({
        id: -1001234567890,
        type: "channel",
        title: "Channel",
        username: "channel_name",
      }),
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

test("opens a public channel through its current public URL", async () => {
  let inviteCalls = 0;
  const prisma = {
    botChannelLink: {
      findFirst: async () => linkedChannel(),
    },
  } as unknown as PrismaClient;
  const telegramBot = {
    botInfo: { id: 999 },
    api: {
      getChat: async () => ({
        id: -1001234567890,
        type: "channel",
        title: "Public",
        username: "current_public_name",
      }),
      createChatInviteLink: async () => {
        inviteCalls += 1;
        return { invite_link: "unused" };
      },
    },
  } as unknown as TelegramBot;

  const result = await openManagedBotChannel(
    prisma,
    telegramBot,
    "bot-id",
    "owner-id",
    "link-id",
  );

  assert.equal(result.url, "https://t.me/current_public_name");
  assert.equal(inviteCalls, 0);
});

test("creates a valid invite link before opening a private channel", async () => {
  const prisma = {
    botChannelLink: {
      findFirst: async () => ({
        ...linkedChannel(),
        channel: { ...linkedChannel().channel, username: null },
      }),
    },
  } as unknown as PrismaClient;
  const telegramBot = {
    botInfo: { id: 999 },
    api: {
      getChat: async () => ({
        id: -1001234567890,
        type: "channel",
        title: "Private",
      }),
      getChatMember: async () => ({
        status: "administrator",
        can_invite_users: true,
      }),
      createChatInviteLink: async () => ({
        invite_link: "https://t.me/+valid",
      }),
    },
  } as unknown as TelegramBot;

  const result = await openManagedBotChannel(
    prisma,
    telegramBot,
    "bot-id",
    "owner-id",
    "link-id",
  );

  assert.equal(result.url, "https://t.me/+valid");
});

test("confirmed missing private invite permission disables only the link", async () => {
  const updates: Array<{ data: { deactivationReason: string } }> = [];
  const prisma = {
    botChannelLink: {
      findFirst: async () => ({
        ...linkedChannel(),
        channel: { ...linkedChannel().channel, username: null },
      }),
      updateMany: async (input: {
        data: { deactivationReason: string };
      }) => {
        updates.push(input);
        return { count: 1 };
      },
    },
  } as unknown as PrismaClient;
  const telegramBot = {
    botInfo: { id: 999 },
    api: {
      getChat: async () => ({
        id: -1001234567890,
        type: "channel",
        title: "Private",
      }),
      getChatMember: async () => ({
        status: "administrator",
        can_invite_users: false,
      }),
    },
  } as unknown as TelegramBot;

  await assert.rejects(
    openManagedBotChannel(
      prisma,
      telegramBot,
      "bot-id",
      "owner-id",
      "link-id",
    ),
    InviteLinkPermissionRequiredError,
  );
  assert.equal(
    updates[0]?.data.deactivationReason,
    INVITE_LINK_PERMISSION_LOST,
  );
});

test("a temporary Telegram failure never disables the channel link", async () => {
  let updateCalls = 0;
  const prisma = {
    botChannelLink: {
      findFirst: async () => linkedChannel(),
      updateMany: async () => {
        updateCalls += 1;
        return { count: 1 };
      },
    },
  } as unknown as PrismaClient;
  const telegramBot = {
    botInfo: { id: 999 },
    api: {
      getChat: async () => {
        throw new Error("ECONNRESET");
      },
    },
  } as unknown as TelegramBot;

  await assert.rejects(
    openManagedBotChannel(
      prisma,
      telegramBot,
      "bot-id",
      "owner-id",
      "link-id",
    ),
    TelegramApiUnavailableError,
  );
  assert.equal(updateCalls, 0);
});

test("confirmed loss of bot membership is not mislabeled as invite permission loss", async () => {
  let updateCalls = 0;
  const prisma = {
    botChannelLink: {
      findFirst: async () => ({
        ...linkedChannel(),
        channel: { ...linkedChannel().channel, username: null },
      }),
      updateMany: async () => {
        updateCalls += 1;
        return { count: 1 };
      },
    },
  } as unknown as PrismaClient;
  const telegramBot = {
    botInfo: { id: 999 },
    api: {
      getChat: async () => ({
        id: -1001234567890,
        type: "channel",
        title: "Private",
      }),
      getChatMember: async () => {
        throw { error_code: 400 };
      },
    },
  } as unknown as TelegramBot;

  await assert.rejects(
    openManagedBotChannel(
      prisma,
      telegramBot,
      "bot-id",
      "owner-id",
      "link-id",
    ),
    BotAdminRequiredError,
  );
  assert.equal(updateCalls, 0);
});

test("activation rejects a private channel until invite permission is restored", async () => {
  let updateCalls = 0;
  const prisma = {
    botChannelLink: {
      findFirst: async () => ({
        ...linkedChannel(),
        status: LinkStatus.INACTIVE,
        channel: { ...linkedChannel().channel, username: null },
      }),
      update: async () => {
        updateCalls += 1;
        return {};
      },
    },
  } as unknown as PrismaClient;
  const telegramBot = {
    botInfo: { id: 999 },
    api: {
      getChat: async () => ({
        id: -1001234567890,
        type: "channel",
        title: "Private",
      }),
      getChatMember: async () => ({
        status: "administrator",
        can_post_messages: true,
        can_delete_messages: true,
        can_invite_users: false,
      }),
    },
  } as unknown as TelegramBot;

  await assert.rejects(
    activateManagedBotChannel(
      prisma,
      telegramBot,
      "bot-id",
      "owner-id",
      "link-id",
    ),
    InviteLinkPermissionRequiredError,
  );
  assert.equal(updateCalls, 0);
});

test("permission updates auto-restore only invite-permission deactivations", async () => {
  const updates: unknown[] = [];
  let reason: string | null = INVITE_LINK_PERMISSION_LOST;
  let botIsActive = true;
  const prisma = {
    botChannelLink: {
      findFirst: async () => ({
        id: "link-id",
        status: LinkStatus.INACTIVE,
        deactivationReason: reason,
        bot: { isActive: botIsActive, deletedAt: null },
        channel: { isActive: true, deletedAt: null },
      }),
      update: async (input: unknown) => {
        updates.push(input);
        return {};
      },
    },
  } as unknown as PrismaClient;

  assert.equal(
    await reconcilePrivateInvitePermission(prisma, {
      botId: "bot-id",
      channelTelegramId: -1001234567890,
      isPrivate: true,
      hasInvitePermission: true,
    }),
    "REACTIVATED",
  );
  assert.equal(updates.length, 1);

  reason = "OWNER_DEACTIVATED";
  assert.equal(
    await reconcilePrivateInvitePermission(prisma, {
      botId: "bot-id",
      channelTelegramId: -1001234567890,
      isPrivate: true,
      hasInvitePermission: true,
    }),
    "UNCHANGED",
  );

  reason = INVITE_LINK_PERMISSION_LOST;
  botIsActive = false;
  assert.equal(
    await reconcilePrivateInvitePermission(prisma, {
      botId: "bot-id",
      channelTelegramId: -1001234567890,
      isPrivate: true,
      hasInvitePermission: true,
    }),
    "UNCHANGED",
  );
  assert.equal(updates.length, 1);
});

test("permission updates record invite loss without replacing manual deactivation", async () => {
  const updates: Array<{
    data: { deactivationReason: string };
  }> = [];
  let status = LinkStatus.ACTIVE;
  let reason: string | null = null;
  const prisma = {
    botChannelLink: {
      findFirst: async () => ({
        id: "link-id",
        status,
        deactivationReason: reason,
        bot: { isActive: true, deletedAt: null },
        channel: { isActive: true, deletedAt: null },
      }),
      updateMany: async (input: {
        data: { deactivationReason: string };
      }) => {
        updates.push(input);
        return { count: 1 };
      },
    },
  } as unknown as PrismaClient;

  assert.equal(
    await reconcilePrivateInvitePermission(prisma, {
      botId: "bot-id",
      channelTelegramId: -1001234567890,
      isPrivate: true,
      hasInvitePermission: false,
    }),
    "DEACTIVATED",
  );
  assert.equal(
    updates[0]?.data.deactivationReason,
    INVITE_LINK_PERMISSION_LOST,
  );

  status = LinkStatus.INACTIVE;
  reason = "OWNER_DEACTIVATED";
  assert.equal(
    await reconcilePrivateInvitePermission(prisma, {
      botId: "bot-id",
      channelTelegramId: -1001234567890,
      isPrivate: true,
      hasInvitePermission: false,
    }),
    "UNCHANGED",
  );
  assert.equal(updates.length, 1);
});

test("making an invite-disabled channel public restores its link", async () => {
  let updateCalls = 0;
  const prisma = {
    botChannelLink: {
      findFirst: async () => ({
        id: "link-id",
        status: LinkStatus.INACTIVE,
        deactivationReason: INVITE_LINK_PERMISSION_LOST,
        bot: { isActive: true, deletedAt: null },
        channel: { isActive: true, deletedAt: null },
      }),
      update: async () => {
        updateCalls += 1;
        return {};
      },
    },
  } as unknown as PrismaClient;

  assert.equal(
    await reconcilePrivateInvitePermission(prisma, {
      botId: "bot-id",
      channelTelegramId: -1001234567890,
      isPrivate: false,
      hasInvitePermission: false,
    }),
    "REACTIVATED",
  );
  assert.equal(updateCalls, 1);
});
