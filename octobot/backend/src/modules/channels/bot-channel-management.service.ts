import {
  LinkStatus,
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

const visibleLinkWhere = {
  OR: [
    { deactivationReason: null },
    { deactivationReason: { not: "OWNER_UNLINKED" } },
  ],
} as const;

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
): Promise<ManagedBotChannelPage> {
  const where = {
    botId,
    bot: { ownerId, deletedAt: null },
    channel: { deletedAt: null },
    ...visibleLinkWhere,
  } as const;
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
) {
  const link = await prisma.botChannelLink.findFirst({
    where: {
      id: linkId,
      botId,
      bot: { ownerId, deletedAt: null },
      channel: { deletedAt: null },
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
): Promise<void> {
  await getManagedBotChannel(prisma, botId, ownerId, linkId);
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
): Promise<void> {
  await getManagedBotChannel(prisma, botId, ownerId, linkId);
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
): Promise<void> {
  const link = await getManagedBotChannel(
    prisma,
    botId,
    ownerId,
    linkId,
  );
  let membership;
  try {
    membership = await telegramBot.api.getChatMember(
      Number(link.channel.channelTelegramId),
      telegramBot.botInfo.id,
    );
  } catch {
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
  await prisma.botChannelLink.update({
    where: { id: linkId },
    data: {
      status: LinkStatus.ACTIVE,
      deactivatedAt: null,
      deactivationReason: null,
    },
  });
}
