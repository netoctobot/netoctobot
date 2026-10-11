import { Prisma, type PrismaClient } from "@prisma/client";
import {
  assignPreliminaryUserSenders,
  assignSenders,
  collectBroadcastChannels,
  collectBroadcastOwners,
  collectBroadcastUsers,
  summarizePlan,
  type BroadcastScope,
  type ProbeResult,
} from "./plan.js";
import type { BroadcastContentKind } from "@prisma/client";
import { parseBroadcastContent, type LinkButtonMatrix } from "./content.js";
import type { createBotTokenValidator } from "./probe.js";
import { summarizeMessageDeletes, type BroadcastDeleteSummary } from "./delete-summary.js";

export type AudienceType = "CHANNELS" | "BOT_USERS" | "BOT_OWNERS";

export interface BroadcastRequest {
  text: string;
  contentKind: BroadcastContentKind;
  caption: string | null;
  linkButtons: LinkButtonMatrix | null;
  mediaUploadId: string | null;
  audienceType: AudienceType;
  targetMode: "ALL" | "SELECTED";
  botIds: string[];
  scope: BroadcastScope;
  includeBotOwners: boolean;
}

export function buildContentPreview(
  request: BroadcastRequest,
  mediaUploadId: string | null,
) {
  const hasMedia = request.contentKind !== "TEXT" && mediaUploadId;
  return {
    contentKind: request.contentKind,
    text: request.contentKind === "TEXT" ? request.text : null,
    caption: request.contentKind === "TEXT" ? null : request.caption,
    linkButtons: request.linkButtons,
    media: hasMedia
      ? {
          mediaUploadId,
          viewPath: `/broadcasts/media/${mediaUploadId}/content`,
        }
      : null,
  };
}

type PreviewRecipient =
  | {
      kind: "channel";
      channelId: string;
      title: string | null;
      username: string | null;
      botId: string;
    }
  | {
      kind: "user";
      userId: string;
      displayName: string | null;
      username: string | null;
      botId: string;
      senderBotId: string;
    };

type ExcludedRecipient =
  | {
      kind: "channel";
      channelId: string;
      title: string | null;
      reason: string;
    }
  | {
      kind: "user";
      userId: string;
      displayName: string | null;
      username: string | null;
      reason: string;
    };

export function parseBroadcastRequest(
  value: unknown,
): BroadcastRequest | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const body = value as Record<string, unknown>;
  const content = parseBroadcastContent(body);
  if (!content) {
    return null;
  }
  const audienceType =
    body.audienceType === "CHANNELS" ||
    body.audienceType === "BOT_USERS" ||
    body.audienceType === "BOT_OWNERS"
      ? body.audienceType
      : body.audienceType === undefined
        ? "CHANNELS"
        : null;
  const targetMode = body.targetMode === "ALL" || body.targetMode === "SELECTED" ? body.targetMode : null;
  const botIds = Array.isArray(body.botIds)
    ? body.botIds.filter((id): id is string => typeof id === "string")
    : [];
  const scope = {
    includeActive: body.includeActive === true,
    includeInactive: body.includeInactive === true,
    includeDeleted: body.includeDeleted === true,
  };
  const includeBotOwners = body.includeBotOwners !== false;
  if (!targetMode || !audienceType) {
    return null;
  }
  if (!scope.includeActive && !scope.includeInactive && !scope.includeDeleted) {
    return null;
  }
  if (targetMode === "SELECTED" && botIds.length === 0) {
    return null;
  }
  return {
    text: content.text,
    contentKind: content.contentKind,
    caption: content.caption,
    linkButtons: content.linkButtons,
    mediaUploadId: content.mediaUploadId,
    audienceType,
    targetMode,
    botIds,
    scope,
    includeBotOwners,
  };
}

async function resolveMediaUpload(prisma: PrismaClient, mediaUploadId: string | null) {
  if (!mediaUploadId) {
    return null;
  }
  const asset = await prisma.broadcastMediaAsset.findUnique({
    where: { id: mediaUploadId },
    select: {
      id: true,
      contentKind: true,
      fileDeletedAt: true,
      campaign: { select: { id: true } },
    },
  });
  if (!asset || asset.fileDeletedAt) {
    return null;
  }
  if (asset.campaign) {
    return null;
  }
  return asset;
}

async function loadScopedBots(prisma: PrismaClient, request: BroadcastRequest) {
  return prisma.bot.findMany({
    where: request.targetMode === "SELECTED" ? { id: { in: request.botIds } } : {},
    select: {
      id: true,
      isActive: true,
      deletedAt: true,
      botUsername: true,
      ownerId: true,
    },
  });
}

async function loadPlatformBotId(prisma: PrismaClient): Promise<string | null> {
  const row = await prisma.platformSettings.findUnique({
    where: { id: "default" },
    select: { platformBotId: true },
  });
  return row?.platformBotId ?? null;
}

async function loadChannelPlan(prisma: PrismaClient, request: BroadcastRequest) {
  const bots = await loadScopedBots(prisma, request);
  const botIds = bots.map((bot) => bot.id);
  const [links, memberships] = await Promise.all([
    prisma.botChannelLink.findMany({
      where: { botId: { in: botIds } },
      select: { botId: true, channelId: true },
    }),
    prisma.supportListMembership.findMany({
      where: { botId: { in: botIds } },
      select: { botId: true, channelId: true, deletedAt: true },
    }),
  ]);
  const channelIds = [
    ...new Set([
      ...links.map((link) => link.channelId),
      ...memberships.map((membership) => membership.channelId),
    ]),
  ];
  const channels = channelIds.length
    ? await prisma.channel.findMany({
        where: { id: { in: channelIds } },
        select: {
          id: true,
          title: true,
          username: true,
          channelTelegramId: true,
          deletedAt: true,
        },
      })
    : [];
  return collectBroadcastChannels({
    bots,
    selectedIds: request.targetMode === "SELECTED" ? request.botIds : null,
    scope: request.scope,
    links,
    memberships,
    channels: channels.map((channel) => ({
      id: channel.id,
      title: channel.title,
      username: channel.username,
      telegramId: channel.channelTelegramId.toString(),
      deletedAt: channel.deletedAt,
    })),
  });
}

async function loadUserPreferences(prisma: PrismaClient, botIds: string[]) {
  if (botIds.length === 0) {
    return [];
  }
  return prisma.userBotPreference.findMany({
    where: {
      botId: { in: botIds },
      privateChatEstablishedAt: { not: null },
    },
    select: {
      userId: true,
      botId: true,
      privateChatEstablishedAt: true,
      lastPrivateInteractionAt: true,
    },
  });
}

async function loadUsers(prisma: PrismaClient, userIds: string[]) {
  if (userIds.length === 0) {
    return [];
  }
  return prisma.user.findMany({
    where: { id: { in: userIds } },
    select: {
      id: true,
      telegramId: true,
      username: true,
      firstName: true,
      lastName: true,
      deletedAt: true,
    },
  });
}

async function loadUserAudiencePlan(prisma: PrismaClient, request: BroadcastRequest) {
  const bots = await loadScopedBots(prisma, request);
  const botIds = bots.map((bot) => bot.id);
  const preferences = await loadUserPreferences(prisma, botIds);
  const userIds = [...new Set(preferences.map((row) => row.userId))];
  const users = await loadUsers(prisma, userIds);
  return collectBroadcastUsers({
    bots,
    selectedIds: request.targetMode === "SELECTED" ? request.botIds : null,
    scope: request.scope,
    includeBotOwners: request.includeBotOwners,
    users: users.map((user) => ({
      userId: user.id,
      telegramId: user.telegramId.toString(),
      username: user.username,
      firstName: user.firstName,
      lastName: user.lastName,
      deletedAt: user.deletedAt,
    })),
    preferences: preferences.map((row) => ({
      userId: row.userId,
      botId: row.botId,
      privateChatEstablishedAt: row.privateChatEstablishedAt!,
      lastPrivateInteractionAt: row.lastPrivateInteractionAt,
    })),
  });
}

async function loadOwnerAudiencePlan(prisma: PrismaClient, request: BroadcastRequest) {
  const bots = await loadScopedBots(prisma, request);
  const botIds = bots.map((bot) => bot.id);
  const ownerIds = [...new Set(bots.map((bot) => bot.ownerId))];
  const platformBotId = await loadPlatformBotId(prisma);
  const preferenceBotIds = [
    ...new Set([...botIds, ...(platformBotId ? [platformBotId] : [])]),
  ];
  const preferences = await loadUserPreferences(prisma, preferenceBotIds);
  const users = await loadUsers(prisma, ownerIds);
  return collectBroadcastOwners({
    bots,
    selectedIds: request.targetMode === "SELECTED" ? request.botIds : null,
    scope: request.scope,
    platformBotId,
    users: users.map((user) => ({
      userId: user.id,
      telegramId: user.telegramId.toString(),
      username: user.username,
      firstName: user.firstName,
      lastName: user.lastName,
      deletedAt: user.deletedAt,
    })),
    preferences: preferences.map((row) => ({
      userId: row.userId,
      botId: row.botId,
      privateChatEstablishedAt: row.privateChatEstablishedAt!,
      lastPrivateInteractionAt: row.lastPrivateInteractionAt,
    })),
  });
}

export async function previewBroadcast(
  prisma: PrismaClient,
  request: BroadcastRequest,
  probe: (botId: string, channelId: string) => Promise<ProbeResult>,
  tokenValid: ReturnType<typeof createBotTokenValidator>,
) {
  let linkedMediaId: string | null = null;
  if (request.contentKind !== "TEXT") {
    const asset = await resolveMediaUpload(prisma, request.mediaUploadId);
    if (!asset || asset.contentKind !== request.contentKind) {
      return null;
    }
    linkedMediaId = asset.id;
  }
  const content = buildContentPreview(request, linkedMediaId);
  if (request.audienceType === "CHANNELS") {
    const collected = await loadChannelPlan(prisma, request);
    const assigned = await assignSenders(collected.included, probe);
    const eligible: PreviewRecipient[] = assigned.eligible.map((channel) => ({
      kind: "channel",
      channelId: channel.channelId,
      title: channel.title,
      username: channel.username,
      botId: channel.botId,
    }));
    const excluded: ExcludedRecipient[] = [
      ...collected.excluded.map((channel) => ({
        kind: "channel" as const,
        channelId: channel.channelId,
        title: channel.title,
        reason: channel.reason,
      })),
      ...assigned.excluded.map((channel) => ({
        kind: "channel" as const,
        channelId: channel.channelId,
        title: channel.title,
        reason: channel.reason,
      })),
    ];
    return {
      text: request.text,
      audienceType: request.audienceType,
      preliminary: false,
      summary: summarizePlan(eligible.length, excluded.length),
      content,
      eligible,
      excluded,
    };
  }

  const collected =
    request.audienceType === "BOT_USERS"
      ? await loadUserAudiencePlan(prisma, request)
      : await loadOwnerAudiencePlan(prisma, request);
  const tokenCache = new Map<string, boolean>();
  const isValid = async (botId: string) => {
    const cached = tokenCache.get(botId);
    if (cached !== undefined) {
      return cached;
    }
    const ok = await tokenValid(botId);
    tokenCache.set(botId, ok);
    return ok;
  };
  for (const user of collected.included) {
    await isValid(user.botId);
  }
  const reassigned = assignPreliminaryUserSenders(
    collected.included,
    (botId) => tokenCache.get(botId) === true,
  );

  const eligible: PreviewRecipient[] = reassigned.eligible.map((user) => ({
    kind: "user",
    userId: user.userId,
    displayName: user.displayName,
    username: user.username,
    botId: user.botId,
    senderBotId: user.botId,
  }));
  const excluded: ExcludedRecipient[] = [
    ...collected.excluded.map((user) => ({
      kind: "user" as const,
      userId: user.userId,
      displayName: user.displayName,
      username: user.username,
      reason: user.reason,
    })),
    ...reassigned.excluded.map((user) => ({
      kind: "user" as const,
      userId: user.userId,
      displayName: user.displayName,
      username: user.username,
      reason: user.reason,
    })),
  ];
  return {
    text: request.text,
    audienceType: request.audienceType,
    preliminary: true,
    summary: summarizePlan(eligible.length, excluded.length),
    content,
    eligible,
    excluded,
  };
}

export async function createBroadcast(
  prisma: PrismaClient,
  adminUsername: string,
  request: BroadcastRequest,
  probe: (botId: string, channelId: string) => Promise<ProbeResult>,
  tokenValid: ReturnType<typeof createBotTokenValidator>,
): Promise<{ id: string; deliveryIds: string[] } | null> {
  const knownBots =
    request.targetMode === "SELECTED"
      ? await prisma.bot.findMany({
          where: { id: { in: request.botIds } },
          select: { id: true },
        })
      : [];
  const knownIds = new Set(knownBots.map((bot) => bot.id));
  const preview = await previewBroadcast(prisma, request, probe, tokenValid);
  if (!preview) {
    return null;
  }

  const deliveryCreates =
    request.audienceType === "CHANNELS"
      ? [
          ...preview.eligible.map((row) => {
            if (row.kind !== "channel") {
              throw new Error("unexpected preview row");
            }
            return {
              channelId: row.channelId,
              botId: row.botId,
              status: "PENDING" as const,
            };
          }),
          ...preview.excluded.map((row) => {
            if (row.kind !== "channel") {
              throw new Error("unexpected preview row");
            }
            return {
              channelId: row.channelId,
              status: "EXCLUDED" as const,
              reason: row.reason,
            };
          }),
        ]
      : [
          ...preview.eligible.map((row) => {
            if (row.kind !== "user") {
              throw new Error("unexpected preview row");
            }
            return {
              userId: row.userId,
              botId: row.botId,
              status: "PENDING" as const,
            };
          }),
          ...preview.excluded.map((row) => {
            if (row.kind !== "user") {
              throw new Error("unexpected preview row");
            }
            return {
              userId: row.userId,
              status: "EXCLUDED" as const,
              reason: row.reason,
            };
          }),
        ];

  const campaign = await prisma.broadcastCampaign.create({
    data: {
      text: request.contentKind === "TEXT" ? request.text : "",
      contentKind: request.contentKind,
      caption: request.caption,
      linkButtons:
        request.linkButtons === null
          ? undefined
          : (request.linkButtons as unknown as Prisma.InputJsonValue),
      mediaAssetId: preview.content.media?.mediaUploadId ?? null,
      audienceType: request.audienceType,
      targetMode: request.targetMode,
      includeActive: request.scope.includeActive,
      includeInactive: request.scope.includeInactive,
      includeDeleted: request.scope.includeDeleted,
      includeBotOwners: request.includeBotOwners,
      createdByAdmin: adminUsername,
      bots:
        request.targetMode === "SELECTED"
          ? {
              create: request.botIds
                .filter((botId) => knownIds.has(botId))
                .map((botId) => ({ botId })),
            }
          : undefined,
      deliveries: {
        create: deliveryCreates,
      },
    },
    select: { id: true },
  });
  const pendingDeliveries = await prisma.broadcastDelivery.findMany({
    where: { campaignId: campaign.id, status: "PENDING" },
    select: { id: true },
  });
  return {
    id: campaign.id,
    deliveryIds: pendingDeliveries.map((delivery) => delivery.id),
  };
}

export async function listBroadcastBots(prisma: PrismaClient) {
  const bots = await prisma.bot.findMany({
    orderBy: { botUsername: "asc" },
    take: 500,
    select: {
      id: true,
      botUsername: true,
      botType: true,
      isActive: true,
      deletedAt: true,
    },
  });
  return {
    items: bots.map((bot) => ({
      ...bot,
      deletedAt: bot.deletedAt?.toISOString() ?? null,
    })),
  };
}

export async function listBroadcasts(prisma: PrismaClient) {
  const rows = await prisma.broadcastCampaign.findMany({
    orderBy: { createdAt: "desc" },
    take: 50,
    select: {
      id: true,
      text: true,
      contentKind: true,
      status: true,
      audienceType: true,
      targetMode: true,
      createdAt: true,
      stopRequested: true,
      deleteRequested: true,
      deliveries: { select: { status: true } },
    },
  });
  return {
    items: rows.map((row) => ({
      id: row.id,
      text: row.text,
      contentKind: row.contentKind,
      status: row.status,
      audienceType: row.audienceType,
      targetMode: row.targetMode,
      createdAt: row.createdAt.toISOString(),
      stopRequested: row.stopRequested,
      deleteRequested: row.deleteRequested,
      counts: countStatuses(row.deliveries),
    })),
  };
}

export async function readBroadcast(prisma: PrismaClient, id: string) {
  const row = await prisma.broadcastCampaign.findUnique({
    where: { id },
    select: {
      id: true,
      text: true,
      contentKind: true,
      caption: true,
      linkButtons: true,
      mediaAssetId: true,
      status: true,
      audienceType: true,
      targetMode: true,
      includeActive: true,
      includeInactive: true,
      includeDeleted: true,
      includeBotOwners: true,
      createdByAdmin: true,
      stopRequested: true,
      deleteRequested: true,
      createdAt: true,
      deliveries: {
        select: {
          id: true,
          status: true,
          reason: true,
          telegramMessageId: true,
          recipientTelegramChatId: true,
          botId: true,
          channel: { select: { title: true, username: true } },
          user: {
            select: { username: true, firstName: true, lastName: true },
          },
          bot: { select: { botUsername: true } },
          messages: {
            orderBy: { sortOrder: "asc" },
            select: {
              deleteStatus: true,
              deleteReason: true,
              deletedAt: true,
              deleteSettledAt: true,
            },
          },
        },
      },
    },
  });
  if (!row) {
    return null;
  }
  const messageRows = row.deliveries.flatMap((delivery) => delivery.messages);
  const deleteSummary: BroadcastDeleteSummary = summarizeMessageDeletes(
    messageRows,
    row.deleteRequested,
  );
  const content = buildContentPreview(
    {
      text: row.text,
      contentKind: row.contentKind,
      caption: row.caption,
      linkButtons: row.linkButtons as LinkButtonMatrix | null,
      mediaUploadId: row.mediaAssetId,
      audienceType: row.audienceType,
      targetMode: row.targetMode,
      botIds: [],
      scope: { includeActive: true, includeInactive: false, includeDeleted: false },
      includeBotOwners: row.includeBotOwners,
    },
    row.mediaAssetId,
  );
  return {
    id: row.id,
    text: row.text,
    contentKind: row.contentKind,
    caption: row.caption,
    linkButtons: row.linkButtons,
    content,
    status: row.status,
    audienceType: row.audienceType,
    targetMode: row.targetMode,
    includeActive: row.includeActive,
    includeInactive: row.includeInactive,
    includeDeleted: row.includeDeleted,
    includeBotOwners: row.includeBotOwners,
    createdByAdmin: row.createdByAdmin,
    stopRequested: row.stopRequested,
    deleteRequested: row.deleteRequested,
    deleteSummary,
    createdAt: row.createdAt.toISOString(),
    counts: countStatuses(row.deliveries),
    deliveries: row.deliveries.map((delivery) => {
      const message = delivery.messages[0];
      return {
        id: delivery.id,
        status: delivery.status,
        reason: delivery.reason,
        messageId: delivery.telegramMessageId?.toString() ?? null,
        chatId: delivery.recipientTelegramChatId?.toString() ?? null,
        senderBotUsername: delivery.bot?.botUsername ?? null,
        title: delivery.channel?.title ?? null,
        username: delivery.channel?.username ?? delivery.user?.username ?? null,
        displayName:
          delivery.user?.firstName || delivery.user?.lastName
            ? [delivery.user.firstName, delivery.user.lastName].filter(Boolean).join(" ")
            : delivery.user?.username ?? null,
        kind: delivery.channel ? "channel" : "user",
        messageDeleteStatus: message?.deleteStatus ?? null,
        messageDeleteReason: message?.deleteReason ?? null,
      };
    }),
  };
}

export async function requestCampaignTelegramDelete(
  prisma: PrismaClient,
  id: string,
): Promise<{ id: string; deleteRequested: true; stopRequested: boolean } | null> {
  const row = await prisma.broadcastCampaign.findUnique({
    where: { id },
    select: { id: true, status: true, stopRequested: true },
  });
  if (!row) {
    return null;
  }
  const shouldStop = row.status === "RUNNING";
  await prisma.broadcastCampaign.update({
    where: { id },
    data: {
      deleteRequested: true,
      ...(shouldStop ? { stopRequested: true } : {}),
    },
  });
  return {
    id,
    deleteRequested: true,
    stopRequested: shouldStop || row.stopRequested,
  };
}

export async function stopBroadcast(prisma: PrismaClient, id: string): Promise<boolean> {
  const row = await prisma.broadcastCampaign.findUnique({
    where: { id },
    select: { id: true, status: true },
  });
  if (!row || row.status === "COMPLETED" || row.status === "STOPPED") {
    return false;
  }
  await prisma.broadcastCampaign.update({
    where: { id },
    data: { stopRequested: true },
  });
  return true;
}

function countStatuses(deliveries: Array<{ status: string }>) {
  const counts: Record<string, number> = {};
  for (const delivery of deliveries) {
    counts[delivery.status] = (counts[delivery.status] ?? 0) + 1;
  }
  return counts;
}
