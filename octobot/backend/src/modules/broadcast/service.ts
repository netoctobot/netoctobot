import type { PrismaClient } from "@prisma/client";
import {
  assignSenders,
  collectBroadcastChannels,
  type BroadcastScope,
  type ProbeResult,
} from "./plan.js";

export interface BroadcastRequest {
  text: string;
  targetMode: "ALL" | "SELECTED";
  botIds: string[];
  scope: BroadcastScope;
}

export function parseBroadcastRequest(
  value: unknown,
): BroadcastRequest | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const body = value as Record<string, unknown>;
  const text = typeof body.text === "string" ? body.text.trim() : "";
  const targetMode = body.targetMode === "ALL" || body.targetMode === "SELECTED" ? body.targetMode : null;
  const botIds = Array.isArray(body.botIds)
    ? body.botIds.filter((id): id is string => typeof id === "string")
    : [];
  const scope = {
    includeActive: body.includeActive === true,
    includeInactive: body.includeInactive === true,
    includeDeleted: body.includeDeleted === true,
  };
  if (!text || text.length > 4096 || !targetMode) {
    return null;
  }
  if (!scope.includeActive && !scope.includeInactive && !scope.includeDeleted) {
    return null;
  }
  if (targetMode === "SELECTED" && botIds.length === 0) {
    return null;
  }
  return { text, targetMode, botIds, scope };
}

async function loadPlan(prisma: PrismaClient, request: BroadcastRequest) {
  const bots = await prisma.bot.findMany({
    where: request.targetMode === "SELECTED" ? { id: { in: request.botIds } } : {},
    select: { id: true, isActive: true, deletedAt: true, botUsername: true },
  });
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

export async function previewBroadcast(
  prisma: PrismaClient,
  request: BroadcastRequest,
  probe: (botId: string, channelId: string) => Promise<ProbeResult>,
) {
  const collected = await loadPlan(prisma, request);
  const assigned = await assignSenders(collected.included, probe);
  return {
    text: request.text,
    eligible: assigned.eligible.map((channel) => ({
      channelId: channel.channelId,
      title: channel.title,
      username: channel.username,
      botId: channel.botId,
    })),
    excluded: [...collected.excluded, ...assigned.excluded],
  };
}

export async function createBroadcast(
  prisma: PrismaClient,
  adminUsername: string,
  request: BroadcastRequest,
  probe: (botId: string, channelId: string) => Promise<ProbeResult>,
): Promise<{ id: string; deliveryIds: string[] }> {
  const knownBots =
    request.targetMode === "SELECTED"
      ? await prisma.bot.findMany({
          where: { id: { in: request.botIds } },
          select: { id: true },
        })
      : [];
  const knownIds = new Set(knownBots.map((bot) => bot.id));
  const preview = await previewBroadcast(prisma, request, probe);
  const campaign = await prisma.broadcastCampaign.create({
    data: {
      text: request.text,
      targetMode: request.targetMode,
      includeActive: request.scope.includeActive,
      includeInactive: request.scope.includeInactive,
      includeDeleted: request.scope.includeDeleted,
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
        create: [
          ...preview.eligible.map((channel) => ({
            channelId: channel.channelId,
            botId: channel.botId,
            status: "PENDING" as const,
          })),
          ...preview.excluded.map((channel) => ({
            channelId: channel.channelId,
            status: "EXCLUDED" as const,
            reason: channel.reason,
          })),
        ],
      },
    },
    select: {
      id: true,
      deliveries: { where: { status: "PENDING" }, select: { id: true } },
    },
  });
  return {
    id: campaign.id,
    deliveryIds: campaign.deliveries.map((delivery) => delivery.id),
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
      status: true,
      targetMode: true,
      createdAt: true,
      stopRequested: true,
      deliveries: { select: { status: true } },
    },
  });
  return {
    items: rows.map((row) => ({
      id: row.id,
      text: row.text,
      status: row.status,
      targetMode: row.targetMode,
      createdAt: row.createdAt.toISOString(),
      stopRequested: row.stopRequested,
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
      status: true,
      targetMode: true,
      includeActive: true,
      includeInactive: true,
      includeDeleted: true,
      createdByAdmin: true,
      stopRequested: true,
      createdAt: true,
      deliveries: {
        select: {
          id: true,
          status: true,
          reason: true,
          telegramMessageId: true,
          channel: { select: { title: true, username: true } },
        },
      },
    },
  });
  if (!row) {
    return null;
  }
  return {
    id: row.id,
    text: row.text,
    status: row.status,
    targetMode: row.targetMode,
    includeActive: row.includeActive,
    includeInactive: row.includeInactive,
    includeDeleted: row.includeDeleted,
    createdByAdmin: row.createdByAdmin,
    stopRequested: row.stopRequested,
    createdAt: row.createdAt.toISOString(),
    counts: countStatuses(row.deliveries),
    deliveries: row.deliveries.map((delivery) => ({
      id: delivery.id,
      status: delivery.status,
      reason: delivery.reason,
      messageId: delivery.telegramMessageId?.toString() ?? null,
      title: delivery.channel.title,
      username: delivery.channel.username,
    })),
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
