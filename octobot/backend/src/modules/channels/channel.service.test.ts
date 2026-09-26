import assert from "node:assert/strict";
import test from "node:test";
import type {
  Bot as DatabaseBot,
  PrismaClient,
} from "@prisma/client";
import { LinkStatus } from "@prisma/client";
import type { Bot as TelegramBot } from "grammy";
import type { Chat, ChatMember } from "grammy/types";
import {
  BotAdminRequiredError,
  BotIdentityMismatchError,
  BotPermissionsRequiredError,
  ChannelNotFoundError,
  ChannelOwnerRequiredError,
  deactivateBotChannelLink,
  ExplicitRelinkRequiredError,
  hasRequiredChannelRights,
  verifyAndLinkChannel,
} from "./channel.service.js";

function membership(value: Partial<ChatMember>): ChatMember {
  return value as ChatMember;
}

test("requires post and delete rights but not edit or invite rights", () => {
  assert.equal(
    hasRequiredChannelRights(
      membership({
        status: "administrator",
        can_post_messages: true,
        can_delete_messages: true,
        can_edit_messages: false,
        can_invite_users: false,
      }),
    ),
    true,
  );
  assert.equal(
    hasRequiredChannelRights(
      membership({
        status: "administrator",
        can_post_messages: true,
        can_delete_messages: false,
      }),
    ),
    false,
  );
});

function databaseBot(
  telegramBotId = 999n,
): DatabaseBot {
  return {
    id: "database-bot",
    telegramBotId,
  } as DatabaseBot;
}

function telegramBot(input: {
  chat?: Chat;
  ownerMembership?: ChatMember;
  botMembership?: ChatMember;
  botId?: number;
} = {}): {
  bot: TelegramBot;
  membershipUserIds: number[];
} {
  const membershipUserIds: number[] = [];
  const botId = input.botId ?? 999;
  const chat =
    input.chat ??
    ({
      id: -1001234567890,
      type: "channel",
      title: "Channel",
      username: "channel_name",
    } as Chat);

  return {
    bot: {
      botInfo: { id: botId },
      api: {
        getChat: async () => chat,
        getChatMember: async (_chatId: number, userId: number) => {
          membershipUserIds.push(userId);
          return userId === 123
            ? (input.ownerMembership ??
                membership({ status: "creator" }))
            : (input.botMembership ??
                membership({
                  status: "administrator",
                  can_post_messages: true,
                  can_delete_messages: true,
                }));
        },
        getChatMemberCount: async () => 42,
      },
    } as unknown as TelegramBot,
    membershipUserIds,
  };
}

function prisma(): {
  client: PrismaClient;
  linkedBotIds: string[];
} {
  const linkedBotIds: string[] = [];
  const transaction = {
    channel: {
      upsert: async () => ({
        id: "channel-id",
        channelTelegramId: -1001234567890n,
        title: "Channel",
        username: "channel_name",
      }),
    },
    botChannelLink: {
      upsert: async (input: {
        create: { botId: string };
      }) => {
        linkedBotIds.push(input.create.botId);
        return { id: "link-id" };
      },
    },
    wallet: {
      upsert: async () => ({}),
    },
  };

  return {
    client: {
      $transaction: async (
        callback: (value: typeof transaction) => unknown,
      ) => callback(transaction),
    } as unknown as PrismaClient,
    linkedBotIds,
  };
}

function verifyInput(input: {
  telegramBot: TelegramBot;
  prisma: PrismaClient;
  databaseBot?: DatabaseBot;
  source?: "AUTO" | "MANUAL";
}) {
  return verifyAndLinkChannel({
    prisma: input.prisma,
    telegramBot: input.telegramBot,
    databaseBot: input.databaseBot ?? databaseBot(),
    ownerId: "owner-id",
    ownerTelegramId: 123,
    chatReference: "@channel_name",
    source: input.source,
  });
}

test("checks the exact runtime bot and links that database bot", async () => {
  const runtime = telegramBot();
  const database = prisma();

  const result = await verifyInput({
    telegramBot: runtime.bot,
    prisma: database.client,
  });

  assert.equal(result.linkId, "link-id");
  assert.deepEqual(runtime.membershipUserIds, [123, 999]);
  assert.deepEqual(database.linkedBotIds, ["database-bot"]);
});

test("rejects a runtime whose Telegram identity differs from the database bot", async () => {
  const runtime = telegramBot({ botId: 1000 });
  const database = prisma();

  await assert.rejects(
    verifyInput({
      telegramBot: runtime.bot,
      prisma: database.client,
    }),
    BotIdentityMismatchError,
  );
  assert.deepEqual(runtime.membershipUserIds, []);
});

test("rejects non-channels, non-owners, and invalid bot membership", async () => {
  const cases: Array<{
    runtime: ReturnType<typeof telegramBot>;
    error: new () => Error;
  }> = [
    {
      runtime: telegramBot({
        chat: {
          id: -1001234567890,
          type: "supergroup",
          title: "Group",
        } as Chat,
      }),
      error: ChannelNotFoundError,
    },
    {
      runtime: telegramBot({
        ownerMembership: membership({
          status: "administrator",
        }),
      }),
      error: ChannelOwnerRequiredError,
    },
    {
      runtime: telegramBot({
        botMembership: membership({ status: "member" }),
      }),
      error: BotAdminRequiredError,
    },
    {
      runtime: telegramBot({
        botMembership: membership({
          status: "administrator",
          can_post_messages: true,
          can_delete_messages: false,
        }),
      }),
      error: BotPermissionsRequiredError,
    },
  ];

  for (const value of cases) {
    await assert.rejects(
      verifyInput({
        telegramBot: value.runtime.bot,
        prisma: prisma().client,
      }),
      value.error,
    );
  }
});

test("does not automatically reactivate an inactive existing link", async () => {
  const runtime = telegramBot();
  const transaction = {
    channel: {
      findUnique: async () => ({ id: "channel-id" }),
    },
    botChannelLink: {
      findUnique: async () => ({ status: LinkStatus.INACTIVE }),
    },
  };
  const client = {
    $transaction: async (
      callback: (value: typeof transaction) => unknown,
    ) => callback(transaction),
  } as unknown as PrismaClient;

  await assert.rejects(
    verifyInput({
      telegramBot: runtime.bot,
      prisma: client,
      source: "AUTO",
    }),
    ExplicitRelinkRequiredError,
  );
});

test("records scoped link deactivation and its reason", async () => {
  const updates: unknown[] = [];
  const client = {
    channel: {
      findUnique: async () => ({
        id: "channel-id",
        ownerId: "owner-id",
        owner: { telegramId: 123n },
        botChannelLinks: [
          {
            id: "link-id",
            status: LinkStatus.ACTIVE,
            linkedByTelegramId: 456n,
          },
        ],
      }),
    },
    botChannelLink: {
      update: async (value: unknown) => {
        updates.push(value);
        return {};
      },
    },
  } as unknown as PrismaClient;

  const result = await deactivateBotChannelLink(client, {
    botId: "database-bot",
    channelTelegramId: -1001234567890,
    reason: "PERMISSIONS_LOST",
  });

  assert.equal(result?.notificationTelegramId, 456);
  const update = updates[0] as {
    where: { id: string };
    data: {
      status: LinkStatus;
      deactivatedAt: Date;
      deactivationReason: string;
    };
  };
  assert.equal(update.where.id, "link-id");
  assert.equal(update.data.status, LinkStatus.INACTIVE);
  assert.ok(update.data.deactivatedAt instanceof Date);
  assert.equal(
    update.data.deactivationReason,
    "PERMISSIONS_LOST",
  );
});
