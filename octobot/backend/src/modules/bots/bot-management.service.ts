import {
  BotType,
  LinkStatus,
  type PrismaClient,
} from "@prisma/client";
import {
  MANAGEMENT_PAGE_SIZE,
  ManagedResourceNotFoundError,
} from "../channels/channel-management.service.js";

export interface OwnedBotSummary {
  id: string;
  botUsername: string;
  botType: Exclude<BotType, "PLATFORM_BOT">;
  isActive: boolean;
  activeChannelCount: number;
}

export interface OwnedBotPage {
  items: OwnedBotSummary[];
  page: number;
  pageCount: number;
  total: number;
}

const botSummarySelect = {
  id: true,
  botUsername: true,
  botType: true,
  isActive: true,
  botChannelLinks: {
    select: {
      status: true,
      channel: {
        select: {
          isActive: true,
          deletedAt: true,
        },
      },
    },
  },
} as const;

function toSummary(bot: {
  id: string;
  botUsername: string;
  botType: BotType;
  isActive: boolean;
  botChannelLinks: Array<{
    status: LinkStatus;
    channel: {
      isActive: boolean;
      deletedAt: Date | null;
    };
  }>;
}): OwnedBotSummary {
  if (bot.botType === BotType.PLATFORM_BOT) {
    throw new ManagedResourceNotFoundError();
  }
  return {
    id: bot.id,
    botUsername: bot.botUsername,
    botType: bot.botType,
    isActive: bot.isActive,
    activeChannelCount: bot.botChannelLinks.filter(
      (link) =>
        link.status === LinkStatus.ACTIVE &&
        link.channel.isActive &&
        link.channel.deletedAt === null,
    ).length,
  };
}

export async function listOwnedBots(
  prisma: PrismaClient,
  ownerId: string,
  requestedPage: number,
): Promise<OwnedBotPage> {
  const where = {
    ownerId,
    deletedAt: null,
    botType: { not: BotType.PLATFORM_BOT },
  } as const;
  const total = await prisma.bot.count({ where });
  const pageCount = Math.max(1, Math.ceil(total / MANAGEMENT_PAGE_SIZE));
  const page = Math.min(
    Math.max(0, requestedPage),
    pageCount - 1,
  );
  const bots = await prisma.bot.findMany({
    where,
    select: botSummarySelect,
    orderBy: { createdAt: "desc" },
    skip: page * MANAGEMENT_PAGE_SIZE,
    take: MANAGEMENT_PAGE_SIZE,
  });

  return {
    items: bots.map(toSummary),
    page,
    pageCount,
    total,
  };
}

export async function getOwnedBot(
  prisma: PrismaClient,
  ownerId: string,
  botId: string,
): Promise<OwnedBotSummary> {
  const bot = await prisma.bot.findFirst({
    where: {
      id: botId,
      ownerId,
      deletedAt: null,
      botType: { not: BotType.PLATFORM_BOT },
    },
    select: botSummarySelect,
  });
  if (!bot) {
    throw new ManagedResourceNotFoundError();
  }
  return toSummary(bot);
}
