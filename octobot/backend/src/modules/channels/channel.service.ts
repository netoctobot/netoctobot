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

export class ChannelOwnerRequiredError extends Error {
  constructor() {
    super("The user is not the channel creator");
    this.name = "ChannelOwnerRequiredError";
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
  ownerId: string;
  ownerTelegramId: number;
  chatReference: number | string;
}): Promise<ChannelLinkResult> {
  let chat;
  try {
    chat = await input.telegramBot.api.getChat(input.chatReference);
  } catch {
    throw new ChannelNotFoundError();
  }

  if (chat.type !== "channel") {
    throw new ChannelNotFoundError();
  }

  const ownerMembership = await input.telegramBot.api.getChatMember(
    chat.id,
    input.ownerTelegramId,
  );
  if (ownerMembership.status !== "creator") {
    throw new ChannelOwnerRequiredError();
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
    const channel = await transaction.channel.upsert({
      where: { channelTelegramId: BigInt(chat.id) },
      create: {
        ownerId: input.ownerId,
        channelTelegramId: BigInt(chat.id),
        title: chat.title,
        username: chat.username ?? null,
        memberCount,
      },
      update: {
        ownerId: input.ownerId,
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
      },
      update: {
        permissions,
        status: LinkStatus.ACTIVE,
      },
    });

    await transaction.wallet.upsert({
      where: { userId: input.ownerId },
      create: { userId: input.ownerId },
      update: {},
    });

    return { channel, linkId: link.id };
  });
}
