import { BotType, type Prisma, type PrismaClient } from "@prisma/client";

const PAGE_SIZE = 20;
const CYCLE_STATUSES = ["PENDING", "PUBLISHING", "PUBLISHED"] as const;

export interface PageResult<T> {
  items: T[];
  page: number;
  pageCount: number;
  total: number;
}

export type ListStatus = "active" | "inactive" | "deleted";

export interface AdminListQuery {
  page: number;
  q?: string;
  status?: ListStatus;
  type?: BotType;
  catalog?: "yes" | "no";
}

const LIST_STATUSES = new Set<ListStatus>(["active", "inactive", "deleted"]);

export function adminListQuery(
  source: Record<string, unknown>,
  page: number,
): AdminListQuery {
  const rawQuery = typeof source.q === "string" ? source.q.trim().slice(0, 80) : "";
  const status =
    typeof source.status === "string" && LIST_STATUSES.has(source.status as ListStatus)
      ? (source.status as ListStatus)
      : undefined;
  const type =
    typeof source.type === "string" &&
    (Object.values(BotType) as string[]).includes(source.type)
      ? (source.type as BotType)
      : undefined;
  const catalog =
    source.catalog === "yes" || source.catalog === "no" ? source.catalog : undefined;
  return {
    page,
    ...(rawQuery ? { q: rawQuery } : {}),
    ...(status ? { status } : {}),
    ...(type ? { type } : {}),
    ...(catalog ? { catalog } : {}),
  };
}

function contains(value: string): Prisma.StringFilter {
  return { contains: value, mode: "insensitive" };
}

function exactTelegramId(value: string): bigint | undefined {
  if (!/^[1-9]\d{0,18}$/.test(value)) {
    return undefined;
  }
  return BigInt(value);
}

function activityWhere(
  status: ListStatus | undefined,
): { isActive?: boolean; deletedAt?: null | { not: null } } {
  if (status === "active") {
    return { isActive: true, deletedAt: null };
  }
  if (status === "inactive") {
    return { isActive: false, deletedAt: null };
  }
  if (status === "deleted") {
    return { deletedAt: { not: null } };
  }
  return {};
}

export function userListWhere(query: AdminListQuery): Prisma.UserWhereInput {
  const where: Prisma.UserWhereInput = {};
  if (query.status === "active") {
    where.deletedAt = null;
  } else if (query.status === "deleted") {
    where.deletedAt = { not: null };
  }
  if (!query.q) {
    return where;
  }
  const telegramId = exactTelegramId(query.q);
  where.OR = [
    { username: contains(query.q) },
    { firstName: contains(query.q) },
    { lastName: contains(query.q) },
    { id: query.q },
    ...(telegramId === undefined ? [] : [{ telegramId }]),
  ];
  return where;
}

export function botListWhere(query: AdminListQuery): Prisma.BotWhereInput {
  const where: Prisma.BotWhereInput = {
    ...activityWhere(query.status),
    ...(query.type ? { botType: query.type } : {}),
  };
  if (!query.q) {
    return where;
  }
  where.OR = [
    { botUsername: contains(query.q) },
    { id: query.q },
    { owner: { username: contains(query.q) } },
    { owner: { firstName: contains(query.q) } },
  ];
  return where;
}

export function channelListWhere(query: AdminListQuery): Prisma.ChannelWhereInput {
  const where: Prisma.ChannelWhereInput = {
    ...activityWhere(query.status),
    ...(query.catalog === "yes"
      ? { isPlatformCatalog: true }
      : query.catalog === "no"
        ? { isPlatformCatalog: false }
        : {}),
  };
  if (!query.q) {
    return where;
  }
  const telegramId = exactTelegramId(query.q);
  where.OR = [
    { title: contains(query.q) },
    { username: contains(query.q) },
    { id: query.q },
    ...(telegramId === undefined ? [] : [{ channelTelegramId: telegramId }]),
  ];
  return where;
}

function pageWindow(requested: number, total: number): {
  page: number;
  pageCount: number;
  skip: number;
  take: number;
} {
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const page = Math.min(Math.max(1, requested), pageCount);
  return { page, pageCount, skip: (page - 1) * PAGE_SIZE, take: PAGE_SIZE };
}

function textMap(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  const entries: Record<string, string> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry === "string") {
      entries[key] = entry;
    }
  }
  return entries;
}

function clocks(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is string => typeof item === "string");
}

function userRef(user: {
  id: string;
  telegramId: bigint;
  username: string | null;
  firstName: string | null;
}) {
  return {
    id: user.id,
    telegramId: user.telegramId.toString(),
    username: user.username,
    firstName: user.firstName,
  };
}

const userSelect = {
  id: true,
  telegramId: true,
  username: true,
  firstName: true,
} as const;

export async function readOverview(prisma: PrismaClient) {
  const [users, bots, channels, activeCycles, catalogChannels] =
    await Promise.all([
      prisma.user.count({ where: { deletedAt: null } }),
      prisma.bot.count({ where: { deletedAt: null } }),
      prisma.channel.count({ where: { deletedAt: null } }),
      prisma.supportListCycle.count({
        where: { status: { in: [...CYCLE_STATUSES] } },
      }),
      prisma.platformForcedChannel.count(),
    ]);
  return { users, bots, channels, activeCycles, catalogChannels };
}

export async function readUsers(
  prisma: PrismaClient,
  query: AdminListQuery,
): Promise<PageResult<unknown>> {
  const where = userListWhere(query);
  const total = await prisma.user.count({ where });
  const window = pageWindow(query.page, total);
  const rows = await prisma.user.findMany({
    where,
    orderBy: { createdAt: "desc" },
    skip: window.skip,
    take: window.take,
    select: {
      id: true,
      telegramId: true,
      username: true,
      firstName: true,
      lastName: true,
      createdAt: true,
      deletedAt: true,
    },
  });
  return {
    ...publicPage(window, total),
    items: rows.map((row) => ({
      id: row.id,
      telegramId: row.telegramId.toString(),
      username: row.username,
      firstName: row.firstName,
      lastName: row.lastName,
      createdAt: row.createdAt.toISOString(),
      deletedAt: row.deletedAt?.toISOString() ?? null,
    })),
  };
}

export async function readBots(
  prisma: PrismaClient,
  query: AdminListQuery,
): Promise<PageResult<unknown>> {
  const where = botListWhere(query);
  const total = await prisma.bot.count({ where });
  const window = pageWindow(query.page, total);
  const rows = await prisma.bot.findMany({
    where,
    orderBy: { createdAt: "desc" },
    skip: window.skip,
    take: window.take,
    select: {
      id: true,
      botUsername: true,
      botType: true,
      isActive: true,
      deletedAt: true,
      allowPlatformForced: true,
      owner: { select: userSelect },
      botChannelLinks: {
        select: {
          status: true,
          channel: { select: { isActive: true, deletedAt: true } },
        },
      },
    },
  });
  return {
    ...publicPage(window, total),
    items: rows.map((row) => ({
      id: row.id,
      botUsername: row.botUsername,
      botType: row.botType,
      isActive: row.isActive,
      deletedAt: row.deletedAt?.toISOString() ?? null,
      allowPlatformForced: row.allowPlatformForced,
      owner: userRef(row.owner),
      activeLinkCount: row.botChannelLinks.filter(
        (link) =>
          link.status === "ACTIVE" &&
          link.channel.isActive &&
          link.channel.deletedAt === null,
      ).length,
    })),
  };
}

export async function readBot(prisma: PrismaClient, id: string) {
  const row = await prisma.bot.findUnique({
    where: { id },
    select: {
      id: true,
      botUsername: true,
      botType: true,
      isActive: true,
      deletedAt: true,
      allowPlatformForced: true,
      welcomeMessages: true,
      footerTexts: true,
      createdAt: true,
      owner: { select: userSelect },
      botChannelLinks: {
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          status: true,
          deactivationReason: true,
          channel: {
            select: {
              id: true,
              title: true,
              username: true,
              channelTelegramId: true,
              isActive: true,
              deletedAt: true,
            },
          },
        },
      },
      supportListSettings: {
        select: {
          listName: true,
          timeZone: true,
          publishingEnabled: true,
          scheduleMode: true,
          retentionMinutes: true,
          acceptanceMode: true,
          format: true,
          contactUrl: true,
          customTimes: true,
        },
      },
    },
  });
  if (!row) {
    return null;
  }
  return {
    id: row.id,
    botUsername: row.botUsername,
    botType: row.botType,
    isActive: row.isActive,
    deletedAt: row.deletedAt?.toISOString() ?? null,
    allowPlatformForced: row.allowPlatformForced,
    createdAt: row.createdAt.toISOString(),
    welcomeMessages: textMap(row.welcomeMessages),
    footerTexts: textMap(row.footerTexts),
    owner: userRef(row.owner),
    links: row.botChannelLinks.map((link) => ({
      id: link.id,
      status: link.status,
      deactivationReason: link.deactivationReason,
      channel: {
        id: link.channel.id,
        title: link.channel.title,
        username: link.channel.username,
        telegramId: link.channel.channelTelegramId.toString(),
        isActive: link.channel.isActive,
        deletedAt: link.channel.deletedAt?.toISOString() ?? null,
      },
    })),
    supportList: row.supportListSettings
      ? {
          ...row.supportListSettings,
          customTimes: clocks(row.supportListSettings.customTimes),
        }
      : null,
  };
}

export async function readChannels(
  prisma: PrismaClient,
  query: AdminListQuery,
): Promise<PageResult<unknown>> {
  const where = channelListWhere(query);
  const total = await prisma.channel.count({ where });
  const window = pageWindow(query.page, total);
  const rows = await prisma.channel.findMany({
    where,
    orderBy: { addedAt: "desc" },
    skip: window.skip,
    take: window.take,
    select: {
      id: true,
      title: true,
      username: true,
      channelTelegramId: true,
      memberCount: true,
      isPlatformCatalog: true,
      isActive: true,
      deletedAt: true,
      owner: { select: userSelect },
    },
  });
  return {
    ...publicPage(window, total),
    items: rows.map((row) => ({
      id: row.id,
      title: row.title,
      username: row.username,
      telegramId: row.channelTelegramId.toString(),
      memberCount: row.memberCount,
      isPlatformCatalog: row.isPlatformCatalog,
      isActive: row.isActive,
      deletedAt: row.deletedAt?.toISOString() ?? null,
      owner: userRef(row.owner),
    })),
  };
}

export async function readChannel(prisma: PrismaClient, id: string) {
  const row = await prisma.channel.findUnique({
    where: { id },
    select: {
      id: true,
      title: true,
      username: true,
      channelTelegramId: true,
      memberCount: true,
      isPlatformCatalog: true,
      isActive: true,
      deletedAt: true,
      deactivationReason: true,
      addedAt: true,
      owner: { select: userSelect },
      botChannelLinks: {
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          status: true,
          deactivationReason: true,
          bot: {
            select: {
              id: true,
              botUsername: true,
              botType: true,
              deletedAt: true,
            },
          },
        },
      },
    },
  });
  if (!row) {
    return null;
  }
  return {
    id: row.id,
    title: row.title,
    username: row.username,
    telegramId: row.channelTelegramId.toString(),
    memberCount: row.memberCount,
    isPlatformCatalog: row.isPlatformCatalog,
    isActive: row.isActive,
    deletedAt: row.deletedAt?.toISOString() ?? null,
    deactivationReason: row.deactivationReason,
    addedAt: row.addedAt.toISOString(),
    owner: userRef(row.owner),
    links: row.botChannelLinks.map((link) => ({
      id: link.id,
      status: link.status,
      deactivationReason: link.deactivationReason,
      bot: {
        id: link.bot.id,
        botUsername: link.bot.botUsername,
        botType: link.bot.botType,
        deletedAt: link.bot.deletedAt?.toISOString() ?? null,
      },
    })),
  };
}

export async function readPublishing(
  prisma: PrismaClient,
  requestedPage: number,
): Promise<PageResult<unknown>> {
  const where = { botType: "SUPPORT_LIST_BOT" as const };
  const total = await prisma.bot.count({ where });
  const window = pageWindow(requestedPage, total);
  const rows = await prisma.bot.findMany({
    where,
    orderBy: { createdAt: "desc" },
    skip: window.skip,
    take: window.take,
    select: {
      id: true,
      botUsername: true,
      isActive: true,
      deletedAt: true,
      supportListSettings: {
        select: {
          listName: true,
          timeZone: true,
          publishingEnabled: true,
          scheduleMode: true,
          cycles: {
            where: { status: "PENDING" },
            orderBy: { scheduledAt: "asc" },
            take: 1,
            select: { scheduledAt: true, deleteAt: true },
          },
        },
      },
    },
  });
  return {
    ...publicPage(window, total),
    items: rows.map((row) => ({
      id: row.id,
      botUsername: row.botUsername,
      isActive: row.isActive,
      deletedAt: row.deletedAt?.toISOString() ?? null,
      listName: row.supportListSettings?.listName ?? null,
      timeZone: row.supportListSettings?.timeZone ?? null,
      publishingEnabled: row.supportListSettings?.publishingEnabled ?? null,
      scheduleMode: row.supportListSettings?.scheduleMode ?? null,
      nextSlot: row.supportListSettings?.cycles[0]
        ? {
            scheduledAt:
              row.supportListSettings.cycles[0].scheduledAt.toISOString(),
            deleteAt: row.supportListSettings.cycles[0].deleteAt.toISOString(),
          }
        : null,
    })),
  };
}

export async function readPublishingDetail(prisma: PrismaClient, botId: string) {
  const row = await prisma.bot.findFirst({
    where: { id: botId, botType: "SUPPORT_LIST_BOT" },
    select: {
      id: true,
      botUsername: true,
      isActive: true,
      deletedAt: true,
      supportListSettings: {
        select: {
          listName: true,
          timeZone: true,
          publishingEnabled: true,
          scheduleMode: true,
          retentionMinutes: true,
          acceptanceMode: true,
          format: true,
          contactUrl: true,
          customTimes: true,
          memberships: {
            orderBy: { createdAt: "desc" },
            select: {
              id: true,
              acceptanceStatus: true,
              participantDisabled: true,
              adminDisabled: true,
              adminDisableReason: true,
              permissionsLost: true,
              inviteUnavailable: true,
              deletedAt: true,
              channel: {
                select: {
                  id: true,
                  title: true,
                  username: true,
                  channelTelegramId: true,
                },
              },
            },
          },
          cycles: {
            orderBy: { scheduledAt: "desc" },
            take: 20,
            select: {
              id: true,
              scheduledAt: true,
              deleteAt: true,
              status: true,
              publications: {
                select: {
                  id: true,
                  status: true,
                  messageId: true,
                  deleteAt: true,
                  membership: {
                    select: {
                      channel: {
                        select: {
                          title: true,
                          username: true,
                          channelTelegramId: true,
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  });
  if (!row) {
    return null;
  }
  const settings = row.supportListSettings;
  return {
    id: row.id,
    botUsername: row.botUsername,
    isActive: row.isActive,
    deletedAt: row.deletedAt?.toISOString() ?? null,
    settings: settings
      ? {
          listName: settings.listName,
          timeZone: settings.timeZone,
          publishingEnabled: settings.publishingEnabled,
          scheduleMode: settings.scheduleMode,
          retentionMinutes: settings.retentionMinutes,
          acceptanceMode: settings.acceptanceMode,
          format: settings.format,
          contactUrl: settings.contactUrl,
          customTimes: clocks(settings.customTimes),
        }
      : null,
    memberships:
      settings?.memberships.map((membership) => ({
        id: membership.id,
        acceptanceStatus: membership.acceptanceStatus,
        participantDisabled: membership.participantDisabled,
        adminDisabled: membership.adminDisabled,
        adminDisableReason: membership.adminDisableReason,
        permissionsLost: membership.permissionsLost,
        inviteUnavailable: membership.inviteUnavailable,
        deletedAt: membership.deletedAt?.toISOString() ?? null,
        channel: {
          id: membership.channel.id,
          title: membership.channel.title,
          username: membership.channel.username,
          telegramId: membership.channel.channelTelegramId.toString(),
        },
      })) ?? [],
    cycles:
      settings?.cycles.map((cycle) => ({
        id: cycle.id,
        scheduledAt: cycle.scheduledAt.toISOString(),
        deleteAt: cycle.deleteAt.toISOString(),
        status: cycle.status,
        publications: cycle.publications.map((publication) => ({
          id: publication.id,
          status: publication.status,
          messageId: publication.messageId?.toString() ?? null,
          deleteAt: publication.deleteAt.toISOString(),
          channel: {
            title: publication.membership.channel.title,
            username: publication.membership.channel.username,
            telegramId:
              publication.membership.channel.channelTelegramId.toString(),
          },
        })),
      })) ?? [],
  };
}

export async function readCatalog(prisma: PrismaClient) {
  const rows = await prisma.platformForcedChannel.findMany({
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    select: {
      id: true,
      isActive: true,
      sortOrder: true,
      channel: {
        select: {
          id: true,
          title: true,
          username: true,
          channelTelegramId: true,
          deletedAt: true,
        },
      },
    },
  });
  return {
    items: rows.map((row) => ({
      id: row.id,
      isActive: row.isActive,
      sortOrder: row.sortOrder,
      channel: {
        id: row.channel.id,
        title: row.channel.title,
        username: row.channel.username,
        telegramId: row.channel.channelTelegramId.toString(),
        deletedAt: row.channel.deletedAt?.toISOString() ?? null,
      },
    })),
  };
}

export async function readForcedSubscriptions(prisma: PrismaClient) {
  const where = { channel: { isPlatformCatalog: false } };
  const [total, rows] = await Promise.all([
    prisma.forcedSubscription.count({ where }),
    prisma.forcedSubscription.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: 100,
      select: {
        id: true,
        createdAt: true,
        bot: { select: { id: true, botUsername: true, botType: true } },
        channel: {
          select: {
            id: true,
            title: true,
            username: true,
            channelTelegramId: true,
          },
        },
        addedByUser: { select: userSelect },
      },
    }),
  ]);
  return {
    total,
    items: rows.map((row) => ({
      id: row.id,
      createdAt: row.createdAt.toISOString(),
      bot: row.bot,
      channel: {
        id: row.channel.id,
        title: row.channel.title,
        username: row.channel.username,
        telegramId: row.channel.channelTelegramId.toString(),
      },
      addedBy: userRef(row.addedByUser),
    })),
  };
}

export async function readAudit(
  prisma: PrismaClient,
  requestedPage: number,
): Promise<PageResult<unknown>> {
  const total = await prisma.auditLog.count();
  const window = pageWindow(requestedPage, total);
  const rows = await prisma.auditLog.findMany({
    orderBy: { createdAt: "desc" },
    skip: window.skip,
    take: window.take,
    select: {
      id: true,
      action: true,
      entityType: true,
      entityId: true,
      details: true,
      createdAt: true,
      user: { select: userSelect },
    },
  });
  return {
    ...publicPage(window, total),
    items: rows.map((row) => ({
      id: row.id,
      action: row.action,
      entityType: row.entityType,
      entityId: row.entityId,
      details: row.details,
      createdAt: row.createdAt.toISOString(),
      actor: row.user ? userRef(row.user) : null,
    })),
  };
}

function publicPage(
  window: { page: number; pageCount: number },
  total: number,
) {
  return { page: window.page, pageCount: window.pageCount, total };
}
