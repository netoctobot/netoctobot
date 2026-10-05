import {
  LinkStatus,
  type Prisma,
  type PrismaClient,
} from "@prisma/client";
import type { Bot as TelegramBot } from "grammy";
import {
  BotAdminRequiredError,
  BotPermissionsRequiredError,
  hasRequiredChannelRights,
} from "./channel.service.js";
import {
  MANAGEMENT_PAGE_SIZE,
  ManagedResourceNotFoundError,
} from "./channel-management.service.js";

export interface ManagedBotChannelLink {
  id: string;
  status: LinkStatus;
  channelId: string;
  title: string | null;
  username: string | null;
  channelTelegramId: bigint;
  channelIsActive: boolean;
}

export interface ManagedBotChannelPage {
  items: ManagedBotChannelLink[];
  page: number;
  pageCount: number;
  total: number;
}

export type ManagedChannelScope =
  | "BOT_OWNER"
  | "CHANNEL_OWNER";

export const INVITE_LINK_PERMISSION_LOST =
  "INVITE_LINK_PERMISSION_LOST";

export class InviteLinkPermissionRequiredError extends Error {
  constructor() {
    super("The bot needs permission to create channel invite links");
    this.name = "InviteLinkPermissionRequiredError";
  }
}

export class TelegramApiUnavailableError extends Error {
  constructor() {
    super("Telegram API is temporarily unavailable");
    this.name = "TelegramApiUnavailableError";
  }
}

function isConfirmedTelegramRejection(error: unknown): boolean {
  const code =
    typeof error === "object" &&
    error !== null &&
    "error_code" in error
      ? Number((error as { error_code: unknown }).error_code)
      : undefined;
  return code !== undefined && code >= 400 && code < 500 && code !== 429;
}

function canCreateInviteLinks(membership: {
  status: string;
  can_invite_users?: boolean;
}): boolean {
  return (
    membership.status === "creator" ||
    (membership.status === "administrator" &&
      Boolean(membership.can_invite_users))
  );
}

function ownershipWhere(
  ownerId: string,
  scope: ManagedChannelScope,
): Prisma.BotChannelLinkWhereInput {
  return scope === "BOT_OWNER"
    ? {
        bot: { ownerId, deletedAt: null },
        channel: { deletedAt: null },
      }
    : { channel: { ownerId, deletedAt: null } };
}

const visibleLinkWhere: Prisma.BotChannelLinkWhereInput = {
  OR: [
    { deactivationReason: null },
    { deactivationReason: { not: "OWNER_UNLINKED" } },
  ],
};

function toSummary(link: {
  id: string;
  status: LinkStatus;
  channel: {
    id: string;
    title: string | null;
    username: string | null;
    channelTelegramId: bigint;
    isActive: boolean;
  };
}): ManagedBotChannelLink {
  return {
    id: link.id,
    status: link.status,
    channelId: link.channel.id,
    title: link.channel.title,
    username: link.channel.username,
    channelTelegramId: link.channel.channelTelegramId,
    channelIsActive: link.channel.isActive,
  };
}

export async function listManagedBotChannels(
  prisma: PrismaClient,
  botId: string,
  ownerId: string,
  requestedPage: number,
  scope: ManagedChannelScope = "BOT_OWNER",
): Promise<ManagedBotChannelPage> {
  const where: Prisma.BotChannelLinkWhereInput = {
    botId,
    ...ownershipWhere(ownerId, scope),
    ...visibleLinkWhere,
  };
  const total = await prisma.botChannelLink.count({ where });
  const pageCount = Math.max(
    1,
    Math.ceil(total / MANAGEMENT_PAGE_SIZE),
  );
  const page = Math.min(
    Math.max(0, requestedPage),
    pageCount - 1,
  );
  const links = await prisma.botChannelLink.findMany({
    where,
    select: {
      id: true,
      status: true,
      channel: {
        select: {
          id: true,
          title: true,
          username: true,
          channelTelegramId: true,
          isActive: true,
        },
      },
    },
    orderBy: { createdAt: "desc" },
    skip: page * MANAGEMENT_PAGE_SIZE,
    take: MANAGEMENT_PAGE_SIZE,
  });
  return {
    items: links.map(toSummary),
    page,
    pageCount,
    total,
  };
}

export async function getManagedBotChannel(
  prisma: PrismaClient,
  botId: string,
  ownerId: string,
  linkId: string,
  scope: ManagedChannelScope = "BOT_OWNER",
) {
  const link = await prisma.botChannelLink.findFirst({
    where: {
      id: linkId,
      botId,
      ...ownershipWhere(ownerId, scope),
      ...visibleLinkWhere,
    },
    include: { channel: true },
  });
  if (!link) {
    throw new ManagedResourceNotFoundError();
  }
  return link;
}

export async function deactivateManagedBotChannel(
  prisma: PrismaClient,
  botId: string,
  ownerId: string,
  linkId: string,
  scope: ManagedChannelScope = "BOT_OWNER",
): Promise<void> {
  await getManagedBotChannel(
    prisma,
    botId,
    ownerId,
    linkId,
    scope,
  );
  await prisma.botChannelLink.update({
    where: { id: linkId },
    data: {
      status: LinkStatus.INACTIVE,
      deactivatedAt: new Date(),
      deactivationReason: "OWNER_DEACTIVATED",
    },
  });
}

export async function removeManagedBotChannel(
  prisma: PrismaClient,
  botId: string,
  ownerId: string,
  linkId: string,
  scope: ManagedChannelScope = "BOT_OWNER",
): Promise<void> {
  await getManagedBotChannel(
    prisma,
    botId,
    ownerId,
    linkId,
    scope,
  );
  await prisma.botChannelLink.update({
    where: { id: linkId },
    data: {
      status: LinkStatus.INACTIVE,
      deactivatedAt: new Date(),
      deactivationReason: "OWNER_UNLINKED",
    },
  });
}

export async function activateManagedBotChannel(
  prisma: PrismaClient,
  telegramBot: TelegramBot,
  botId: string,
  ownerId: string,
  linkId: string,
  scope: ManagedChannelScope = "BOT_OWNER",
): Promise<void> {
  const link = await getManagedBotChannel(
    prisma,
    botId,
    ownerId,
    linkId,
    scope,
  );
  let chat;
  let membership;
  try {
    chat = await telegramBot.api.getChat(
      Number(link.channel.channelTelegramId),
    );
    membership = await telegramBot.api.getChatMember(
      Number(link.channel.channelTelegramId),
      telegramBot.botInfo.id,
    );
  } catch (error) {
    if (isConfirmedTelegramRejection(error)) {
      throw new BotAdminRequiredError();
    }
    throw new TelegramApiUnavailableError();
  }
  if (chat.type !== "channel") {
    throw new BotAdminRequiredError();
  }
  if (
    membership.status !== "administrator" &&
    membership.status !== "creator"
  ) {
    throw new BotAdminRequiredError();
  }
  if (!hasRequiredChannelRights(membership)) {
    throw new BotPermissionsRequiredError();
  }
  if (!chat.username && !canCreateInviteLinks(membership)) {
    throw new InviteLinkPermissionRequiredError();
  }
  await prisma.botChannelLink.update({
    where: { id: linkId },
    data: {
      status: LinkStatus.ACTIVE,
      deactivatedAt: null,
      deactivationReason: null,
    },
  });
}

export async function openManagedBotChannel(
  prisma: PrismaClient,
  telegramBot: TelegramBot,
  botId: string,
  ownerId: string,
  linkId: string,
  scope: ManagedChannelScope = "BOT_OWNER",
): Promise<{ link: Awaited<ReturnType<typeof getManagedBotChannel>>; url: string }> {
  const link = await getManagedBotChannel(
    prisma,
    botId,
    ownerId,
    linkId,
    scope,
  );
  let chat;
  try {
    chat = await telegramBot.api.getChat(
      Number(link.channel.channelTelegramId),
    );
  } catch (error) {
    if (isConfirmedTelegramRejection(error)) {
      throw new BotAdminRequiredError();
    }
    throw new TelegramApiUnavailableError();
  }
  if (chat.type !== "channel") {
    throw new BotAdminRequiredError();
  }
  if (chat.username) {
    return {
      link,
      url: `https://t.me/${chat.username}`,
    };
  }

  let membership;
  try {
    membership = await telegramBot.api.getChatMember(
      chat.id,
      telegramBot.botInfo.id,
    );
  } catch (error) {
    if (isConfirmedTelegramRejection(error)) {
      await deactivateForInvitePermission(prisma, link.id);
      throw new InviteLinkPermissionRequiredError();
    }
    throw new TelegramApiUnavailableError();
  }
  if (!canCreateInviteLinks(membership)) {
    await deactivateForInvitePermission(prisma, link.id);
    throw new InviteLinkPermissionRequiredError();
  }

  try {
    const invite = await telegramBot.api.createChatInviteLink(chat.id, {
      name: "Octobot channel access",
    });
    return { link, url: invite.invite_link };
  } catch (error) {
    if (isConfirmedTelegramRejection(error)) {
      await deactivateForInvitePermission(prisma, link.id);
      throw new InviteLinkPermissionRequiredError();
    }
    throw new TelegramApiUnavailableError();
  }
}

async function deactivateForInvitePermission(
  prisma: PrismaClient,
  linkId: string,
): Promise<void> {
  await prisma.botChannelLink.updateMany({
    where: {
      id: linkId,
      status: LinkStatus.ACTIVE,
    },
    data: {
      status: LinkStatus.INACTIVE,
      deactivatedAt: new Date(),
      deactivationReason: INVITE_LINK_PERMISSION_LOST,
    },
  });
}

export async function reconcilePrivateInvitePermission(
  prisma: PrismaClient,
  input: {
    botId: string;
    channelTelegramId: number;
    isPrivate: boolean;
    hasInvitePermission: boolean;
  },
): Promise<"DEACTIVATED" | "REACTIVATED" | "UNCHANGED"> {
  const link = await prisma.botChannelLink.findFirst({
    where: {
      botId: input.botId,
      channel: {
        channelTelegramId: BigInt(input.channelTelegramId),
      },
    },
    select: {
      id: true,
      status: true,
      deactivationReason: true,
      bot: { select: { isActive: true, deletedAt: true } },
      channel: { select: { isActive: true, deletedAt: true } },
    },
  });
  if (!link || !input.isPrivate) {
    return "UNCHANGED";
  }
  if (!input.hasInvitePermission) {
    if (link.status !== LinkStatus.ACTIVE) {
      return "UNCHANGED";
    }
    await deactivateForInvitePermission(prisma, link.id);
    return "DEACTIVATED";
  }
  if (
    link.status === LinkStatus.INACTIVE &&
    link.deactivationReason === INVITE_LINK_PERMISSION_LOST &&
    link.bot.isActive &&
    !link.bot.deletedAt &&
    link.channel.isActive &&
    !link.channel.deletedAt
  ) {
    await prisma.botChannelLink.update({
      where: { id: link.id },
      data: {
        status: LinkStatus.ACTIVE,
        deactivatedAt: null,
        deactivationReason: null,
      },
    });
    return "REACTIVATED";
  }
  return "UNCHANGED";
}
