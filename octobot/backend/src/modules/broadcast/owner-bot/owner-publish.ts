import { Prisma, type PrismaClient } from "@prisma/client";
import type { Redis } from "ioredis";
import { PrismaClientKnownRequestError } from "@prisma/client/runtime/library";
import type { BroadcastScheduler } from "../scheduler.js";
import {
  buildDeliveryCreatesFromPreview,
  previewBroadcast,
  type BroadcastRequest,
} from "../service.js";
import type { createBotTokenValidator } from "../probe.js";
import type { ProbeResult } from "../plan.js";
import {
  clearOwnerBroadcastDraft,
  saveOwnerBroadcastLastResult,
  type OwnerBroadcastDraft,
} from "./state.js";
import { assertOwnerBotAccess } from "../owner-broadcast-guard.js";

export async function enqueuePendingCampaignDeliveries(
  prisma: PrismaClient,
  scheduler: BroadcastScheduler,
  campaignId: string,
): Promise<string[]> {
  const pending = await prisma.broadcastDelivery.findMany({
    where: { campaignId, status: "PENDING" },
    select: { id: true },
  });
  for (const delivery of pending) {
    try {
      await scheduler.enqueue(campaignId, delivery.id);
    } catch {
      // Retry on next publish attempt with same publishNonce
    }
  }
  return pending.map((row) => row.id);
}

async function createOwnerCampaignRow(
  prisma: PrismaClient,
  input: {
    request: BroadcastRequest;
    preview: Awaited<ReturnType<typeof previewBroadcast>>;
    knownIds: Set<string>;
    userId: string;
    botId: string;
    publishNonce: string;
  },
): Promise<{ id: string }> {
  if (!input.preview) {
    throw new Error("invalid_preview");
  }
  const deliveryCreates = buildDeliveryCreatesFromPreview(
    input.request.audienceType,
    input.preview,
  );
  return prisma.broadcastCampaign.create({
    data: {
      text: input.request.contentKind === "TEXT" ? input.request.text : "",
      contentKind: input.request.contentKind,
      caption: input.request.caption,
      linkButtons:
        input.request.linkButtons === null
          ? undefined
          : (input.request.linkButtons as unknown as Prisma.InputJsonValue),
      mediaAssetId: input.preview.content.media?.mediaUploadId ?? null,
      audienceType: input.request.audienceType,
      targetMode: input.request.targetMode,
      includeActive: input.request.scope.includeActive,
      includeInactive: input.request.scope.includeInactive,
      includeDeleted: input.request.scope.includeDeleted,
      includeBotOwners: input.request.includeBotOwners,
      createdByAdmin: "",
      createdByKind: "BOT_OWNER",
      createdByUserId: input.userId,
      initiatorBotId: input.botId,
      publishNonce: input.publishNonce,
      bots: {
        create: input.request.botIds
          .filter((botId) => input.knownIds.has(botId))
          .map((botId) => ({ botId })),
      },
      deliveries: { create: deliveryCreates },
    },
    select: { id: true },
  });
}

export async function publishOwnerBroadcastCampaign(input: {
  prisma: PrismaClient;
  redis: Redis;
  scheduler: BroadcastScheduler;
  botId: string;
  ownerTelegramId: number;
  publishNonce: string;
  request: BroadcastRequest;
  probe: (botId: string, channelId: string) => Promise<ProbeResult>;
  tokenValid: ReturnType<typeof createBotTokenValidator>;
}): Promise<{ campaignId: string; deliveryIds: string[] }> {
  const { userId } = await assertOwnerBotAccess(
    input.prisma,
    input.botId,
    input.ownerTelegramId,
  );

  const existing = await input.prisma.broadcastCampaign.findUnique({
    where: { publishNonce: input.publishNonce },
    select: { id: true },
  });
  let campaignId = existing?.id;
  if (!campaignId) {
    const knownBots = await input.prisma.bot.findMany({
      where: { id: { in: input.request.botIds } },
      select: { id: true },
    });
    const knownIds = new Set(knownBots.map((bot) => bot.id));
    const preview = await previewBroadcast(
      input.prisma,
      input.request,
      input.probe,
      input.tokenValid,
    );
    if (!preview) {
      throw new Error("invalid_broadcast");
    }
    try {
      const created = await createOwnerCampaignRow(input.prisma, {
        request: input.request,
        preview,
        knownIds,
        userId,
        botId: input.botId,
        publishNonce: input.publishNonce,
      });
      campaignId = created.id;
    } catch (error) {
      if (
        error instanceof PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        const raced = await input.prisma.broadcastCampaign.findUnique({
          where: { publishNonce: input.publishNonce },
          select: { id: true },
        });
        if (!raced) {
          throw error;
        }
        campaignId = raced.id;
      } else {
        throw error;
      }
    }
  }

  const deliveryIds = await enqueuePendingCampaignDeliveries(
    input.prisma,
    input.scheduler,
    campaignId,
  );
  await clearOwnerBroadcastDraft(input.redis, input.botId, input.ownerTelegramId);
  await saveOwnerBroadcastLastResult(input.redis, input.botId, input.ownerTelegramId, {
    campaignId,
  });
  return { campaignId, deliveryIds };
}

export function draftToBroadcastRequest(
  botId: string,
  draft: OwnerBroadcastDraft,
): BroadcastRequest | null {
  if (!draft.audience || !draft.contentKind) {
    return null;
  }
  const audienceType =
    draft.audience === "channels"
      ? "CHANNELS"
      : draft.audience === "users"
        ? "BOT_USERS"
        : "CHANNELS_AND_USERS";
  return {
    text: draft.text ?? "",
    contentKind: draft.contentKind,
    caption: draft.caption ?? null,
    linkButtons: draft.linkButtons ?? null,
    mediaUploadId: draft.mediaAssetId ?? null,
    audienceType,
    targetMode: "SELECTED",
    botIds: [botId],
    scope: { includeActive: true, includeInactive: false, includeDeleted: false },
    includeBotOwners: false,
  };
}
