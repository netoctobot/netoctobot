import {
  LinkStatus,
  type Bot as DatabaseBot,
  type Channel,
  type PrismaClient,
} from "@prisma/client";
import type { Bot as TelegramBot } from "grammy";
import type { ChatMember } from "grammy/types";

export class ChannelNotFoundError extends Error {
  constructor() {
    super("Telegram channel could not be resolved");
    this.name = "ChannelNotFoundError";
  }
}

export class ChannelAdministratorRequiredError extends Error {
  constructor() {
    super("The user is not a channel administrator");
    this.name = "ChannelAdministratorRequiredError";
  }
}

export class BotAdminRequiredError extends Error {
  constructor() {
    super("The selected bot is not a channel administrator");
    this.name = "BotAdminRequiredError";
  }
}

export class BotPermissionsRequiredError extends Error {
  constructor() {
    super("The bot needs post and delete message permissions");
    this.name = "BotPermissionsRequiredError";
  }
}

export class BotIdentityMismatchError extends Error {
  constructor() {
    super("The Telegram runtime does not match the database bot");
    this.name = "BotIdentityMismatchError";
  }
}

export class ExplicitRelinkRequiredError extends Error {
  constructor() {
    super("An inactive channel link requires explicit re-linking");
    this.name = "ExplicitRelinkRequiredError";
  }
}

export type ChannelLinkSource = "AUTO" | "MANUAL";

export type LinkDeactivationReason =
  | "BOT_REMOVED"
  | "PERMISSIONS_LOST"
  | "BOT_DEACTIVATED"
  | "BOT_DELETED"
  | "CHANNEL_DELETED";

export interface BotChannelLinkSnapshot {
  channelId: string;
  linkId: string;
  status: LinkStatus;
  ownerUserId: string;
  notificationTelegramId: number;
}

export function hasRequiredChannelRights(
  membership: ChatMember,
): boolean {
  if (membership.status === "creator") {
    return true;
  }
  return (
    membership.status === "administrator" &&
    Boolean(membership.can_post_messages) &&
    Boolean(membership.can_delete_messages)
  );
}

export interface ChannelLinkResult {
  channel: Channel;
  linkId: string;
}

export async function verifyAndLinkChannel(input: {
  prisma: PrismaClient;
  telegramBot: TelegramBot;
  databaseBot: DatabaseBot;
  addedByUserId: string;
  addedByTelegramId: number;
  chatReference: number | string;
  source?: ChannelLinkSource;
}): Promise<ChannelLinkResult> {
  if (
    BigInt(input.telegramBot.botInfo.id) !==
    input.databaseBot.telegramBotId
  ) {
    throw new BotIdentityMismatchError();
  }

  let chat;
  try {
    chat = await input.telegramBot.api.getChat(input.chatReference);
  } catch {
    throw new ChannelNotFoundError();
  }

  if (chat.type !== "channel") {
    throw new ChannelNotFoundError();
  }

  const botMembership = await input.telegramBot.api.getChatMember(
    chat.id,
    input.telegramBot.botInfo.id,
  );
  if (
    botMembership.status !== "administrator" &&
    botMembership.status !== "creator"
  ) {
    throw new BotAdminRequiredError();
  }
  if (!hasRequiredChannelRights(botMembership)) {
    throw new BotPermissionsRequiredError();
  }

  const actorMembership = await input.telegramBot.api.getChatMember(
    chat.id,
    input.addedByTelegramId,
  );
  if (
    actorMembership.status !== "creator" &&
    actorMembership.status !== "administrator"
  ) {
    throw new ChannelAdministratorRequiredError();
  }

  const administrators =
    await input.telegramBot.api.getChatAdministrators(chat.id);
  const telegramOwner = administrators.find(
    (administrator) => administrator.status === "creator",
  );
  if (!telegramOwner) {
    throw new ChannelNotFoundError();
  }

  const isCreator = botMembership.status === "creator";
  const permissions = {
    status: botMembership.status,
    canPostMessages:
      isCreator || Boolean(botMembership.can_post_messages),
    canEditMessages:
      isCreator || Boolean(botMembership.can_edit_messages),
    canDeleteMessages:
      isCreator || Boolean(botMembership.can_delete_messages),
    canInviteUsers:
      isCreator || Boolean(botMembership.can_invite_users),
    canManageChat:
      isCreator || Boolean(botMembership.can_manage_chat),
  };

  const memberCount = await input.telegramBot.api
    .getChatMemberCount(chat.id)
    .catch(() => 0);

  return input.prisma.$transaction(async (transaction) => {
    if (input.source === "AUTO") {
      const existingChannel = await transaction.channel.findUnique({
        where: { channelTelegramId: BigInt(chat.id) },
        select: { id: true },
      });
      if (existingChannel) {
        const existingLink =
          await transaction.botChannelLink.findUnique({
            where: {
              botId_channelId: {
                botId: input.databaseBot.id,
                channelId: existingChannel.id,
              },
            },
            select: { status: true },
          });
        if (existingLink?.status === LinkStatus.INACTIVE) {
          throw new ExplicitRelinkRequiredError();
        }
      }
    }

    const channel = await transaction.channel.upsert({
      where: { channelTelegramId: BigInt(chat.id) },
      create: {
        ownerId: input.addedByUserId,
        telegramOwnerId: BigInt(telegramOwner.user.id),
        channelTelegramId: BigInt(chat.id),
        title: chat.title,
        username: chat.username ?? null,
        memberCount,
      },
      update: {
        telegramOwnerId: BigInt(telegramOwner.user.id),
        title: chat.title,
        username: chat.username ?? null,
        memberCount,
        isActive: true,
        deactivationReason: null,
        deletedAt: null,
      },
    });

    const link = await transaction.botChannelLink.upsert({
      where: {
        botId_channelId: {
          botId: input.databaseBot.id,
          channelId: channel.id,
        },
      },
      create: {
        botId: input.databaseBot.id,
        channelId: channel.id,
        permissions,
        status: LinkStatus.ACTIVE,
        linkedByTelegramId: BigInt(input.addedByTelegramId),
      },
      update: {
        permissions,
        status: LinkStatus.ACTIVE,
        linkedByTelegramId: BigInt(input.addedByTelegramId),
        deactivatedAt: null,
        deactivationReason: null,
      },
    });

    await transaction.wallet.upsert({
      where: { userId: input.addedByUserId },
      create: { userId: input.addedByUserId },
      update: {},
    });

    return { channel, linkId: link.id };
  });
}

export async function getBotChannelLinkSnapshot(
  prisma: PrismaClient,
  input: {
    botId: string;
    channelTelegramId: number;
  },
): Promise<BotChannelLinkSnapshot | null> {
  const channel = await prisma.channel.findUnique({
    where: {
      channelTelegramId: BigInt(input.channelTelegramId),
    },
    select: {
      id: true,
      ownerId: true,
      owner: { select: { telegramId: true } },
      botChannelLinks: {
        where: { botId: input.botId },
        take: 1,
        select: {
          id: true,
          status: true,
          linkedByTelegramId: true,
        },
      },
    },
  });
  const link = channel?.botChannelLinks[0];
  if (!channel || !link) {
    return null;
  }

  return {
    channelId: channel.id,
    linkId: link.id,
    status: link.status,
    ownerUserId: channel.ownerId,
    notificationTelegramId: Number(
      link.linkedByTelegramId ?? channel.owner.telegramId,
    ),
  };
}

export async function deactivateBotChannelLink(
  prisma: PrismaClient,
  input: {
    botId: string;
    channelTelegramId: number;
    reason: LinkDeactivationReason;
  },
): Promise<BotChannelLinkSnapshot | null> {
  const snapshot = await getBotChannelLinkSnapshot(prisma, input);
  if (!snapshot || snapshot.status === LinkStatus.INACTIVE) {
    return null;
  }

  await prisma.botChannelLink.update({
    where: { id: snapshot.linkId },
    data: {
      status: LinkStatus.INACTIVE,
      deactivatedAt: new Date(),
      deactivationReason: input.reason,
    },
  });
  return snapshot;
}
