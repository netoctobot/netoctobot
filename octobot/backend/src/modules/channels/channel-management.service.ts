import {
  BotType,
  LinkStatus,
  type PrismaClient,
} from "@prisma/client";

export const MANAGEMENT_PAGE_SIZE = 5;

export class ManagedResourceNotFoundError extends Error {
  constructor() {
    super("The managed resource was not found");
    this.name = "ManagedResourceNotFoundError";
  }
}

export interface OwnedChannelSummary {
  id: string;
  title: string | null;
  username: string | null;
  channelTelegramId: bigint;
  isActive: boolean;
  activeLinkCount: number;
  linkedBotTypes: BotType[];
}

export interface OwnedChannelPage {
  items: OwnedChannelSummary[];
  page: number;
  pageCount: number;
  total: number;
}

const channelSummarySelect = {
  id: true,
  title: true,
  username: true,
  channelTelegramId: true,
  isActive: true,
  botChannelLinks: {
    select: {
      status: true,
      bot: {
        select: {
          botType: true,
          isActive: true,
          deletedAt: true,
        },
      },
    },
  },
} as const;

function toSummary(channel: {
  id: string;
  title: string | null;
  username: string | null;
  channelTelegramId: bigint;
  isActive: boolean;
  botChannelLinks: Array<{
    status: LinkStatus;
    bot: {
      botType: BotType;
      isActive: boolean;
      deletedAt: Date | null;
    };
  }>;
}): OwnedChannelSummary {
  const operationalLinks = channel.botChannelLinks.filter(
    (link) =>
      link.status === LinkStatus.ACTIVE &&
      link.bot.isActive &&
      link.bot.deletedAt === null,
  );

  return {
    id: channel.id,
    title: channel.title,
    username: channel.username,
    channelTelegramId: channel.channelTelegramId,
    isActive: channel.isActive,
    activeLinkCount: operationalLinks.length,
    linkedBotTypes: [
      ...new Set(operationalLinks.map((link) => link.bot.botType)),
    ],
  };
}

export async function listOwnedChannels(
  prisma: PrismaClient,
  ownerId: string,
  requestedPage: number,
): Promise<OwnedChannelPage> {
  const where = {
    ownerId,
    deletedAt: null,
    isPlatformCatalog: false,
  } as const;
  const total = await prisma.channel.count({ where });
  const pageCount = Math.max(1, Math.ceil(total / MANAGEMENT_PAGE_SIZE));
  const page = Math.min(
    Math.max(0, requestedPage),
    pageCount - 1,
  );
  const channels = await prisma.channel.findMany({
    where,
    select: channelSummarySelect,
    orderBy: { addedAt: "desc" },
    skip: page * MANAGEMENT_PAGE_SIZE,
    take: MANAGEMENT_PAGE_SIZE,
  });

  return {
    items: channels.map(toSummary),
    page,
    pageCount,
    total,
  };
}

export async function getOwnedChannel(
  prisma: PrismaClient,
  ownerId: string,
  channelId: string,
): Promise<OwnedChannelSummary> {
  const channel = await prisma.channel.findFirst({
    where: {
      id: channelId,
      ownerId,
      deletedAt: null,
      isPlatformCatalog: false,
    },
    select: channelSummarySelect,
  });
  if (!channel) {
    throw new ManagedResourceNotFoundError();
  }
  return toSummary(channel);
}

export async function setOwnedChannelActive(
  prisma: PrismaClient,
  input: {
    ownerId: string;
    channelId: string;
    isActive: boolean;
  },
): Promise<void> {
  await prisma.$transaction(async (transaction) => {
    const updated = await transaction.channel.updateMany({
      where: {
        id: input.channelId,
        ownerId: input.ownerId,
        deletedAt: null,
        isPlatformCatalog: false,
      },
      data: {
        isActive: input.isActive,
        deactivationReason: input.isActive ? null : "OWNER_PAUSED",
      },
    });
    if (updated.count !== 1) {
      throw new ManagedResourceNotFoundError();
    }
    await transaction.auditLog.create({
      data: {
        userId: input.ownerId,
        action: input.isActive
          ? "CHANNEL_ACTIVATED"
          : "CHANNEL_DEACTIVATED",
        entityType: "Channel",
        entityId: input.channelId,
      },
    });
  });
}

export async function softDeleteOwnedChannel(
  prisma: PrismaClient,
  input: {
    ownerId: string;
    channelId: string;
  },
): Promise<void> {
  const deletedAt = new Date();
  await prisma.$transaction(async (transaction) => {
    const updated = await transaction.channel.updateMany({
      where: {
        id: input.channelId,
        ownerId: input.ownerId,
        deletedAt: null,
        isPlatformCatalog: false,
      },
      data: {
        isActive: false,
        deletedAt,
        deactivationReason: "OWNER_REMOVED",
      },
    });
    if (updated.count !== 1) {
      throw new ManagedResourceNotFoundError();
    }
    await transaction.botChannelLink.updateMany({
      where: { channelId: input.channelId },
      data: {
        status: LinkStatus.INACTIVE,
        deactivatedAt: deletedAt,
        deactivationReason: "CHANNEL_DELETED",
      },
    });
    await transaction.auditLog.create({
      data: {
        userId: input.ownerId,
        action: "CHANNEL_SOFT_DELETED",
        entityType: "Channel",
        entityId: input.channelId,
      },
    });
  });
}
