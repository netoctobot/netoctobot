import type { PrismaClient } from "@prisma/client";
import { PRODUCT_LIMITS } from "./content.js";
import { deleteMediaFile } from "./media-storage.js";

/** True when the asset must stay on disk (active campaign or in-flight / retry deliveries). */
export async function mediaAssetHasActiveSendWork(
  prisma: PrismaClient,
  mediaAssetId: string,
): Promise<boolean> {
  const running = await prisma.broadcastCampaign.findFirst({
    where: { mediaAssetId, status: "RUNNING" },
    select: { id: true },
  });
  if (running) {
    return true;
  }
  const pending = await prisma.broadcastDelivery.count({
    where: {
      campaign: { mediaAssetId },
      status: "PENDING",
    },
  });
  return pending > 0;
}

export async function cleanupOrphanUploads(
  prisma: PrismaClient,
  mediaRoot: string,
  now = new Date(),
): Promise<number> {
  const cutoff = new Date(now.getTime() - PRODUCT_LIMITS.orphanUploadTtlHours * 60 * 60 * 1000);
  const orphans = await prisma.broadcastMediaAsset.findMany({
    where: {
      campaign: { is: null },
      expiresAt: { lte: now },
      createdAt: { lte: cutoff },
      fileDeletedAt: null,
    },
    select: { id: true, storageKey: true },
  });
  let removed = 0;
  for (const asset of orphans) {
    await deleteMediaFile(mediaRoot, asset.storageKey).catch(() => undefined);
    await prisma.broadcastMediaAsset.update({
      where: { id: asset.id },
      data: { fileDeletedAt: now },
    });
    removed += 1;
  }
  return removed;
}

export async function cleanupFinishedCampaignMedia(
  prisma: PrismaClient,
  mediaRoot: string,
  now = new Date(),
): Promise<number> {
  const cutoff = new Date(
    now.getTime() - PRODUCT_LIMITS.fileDeleteAfterCampaignEndHours * 60 * 60 * 1000,
  );
  const campaigns = await prisma.broadcastCampaign.findMany({
    where: {
      endedAt: { not: null, lte: cutoff },
      mediaAssetId: { not: null },
      status: { in: ["COMPLETED", "STOPPED"] },
    },
    select: {
      id: true,
      mediaAsset: {
        select: { id: true, storageKey: true, fileDeletedAt: true },
      },
    },
  });
  let removed = 0;
  for (const campaign of campaigns) {
    const asset = campaign.mediaAsset;
    if (!asset || asset.fileDeletedAt) {
      continue;
    }
    if (await mediaAssetHasActiveSendWork(prisma, asset.id)) {
      continue;
    }
    const otherCampaign = await prisma.broadcastCampaign.findFirst({
      where: {
        mediaAssetId: asset.id,
        id: { not: campaign.id },
      },
      select: { id: true },
    });
    if (otherCampaign) {
      continue;
    }
    await deleteMediaFile(mediaRoot, asset.storageKey).catch(() => undefined);
    await prisma.broadcastMediaAsset.update({
      where: { id: asset.id },
      data: { fileDeletedAt: now },
    });
    removed += 1;
  }
  return removed;
}

export function startMediaCleanupLoop(
  prisma: PrismaClient,
  mediaRoot: string,
  intervalMs = 60 * 60 * 1000,
): () => void {
  const tick = () => {
    void cleanupOrphanUploads(prisma, mediaRoot).catch(() => undefined);
    void cleanupFinishedCampaignMedia(prisma, mediaRoot).catch(() => undefined);
  };
  const timer = setInterval(tick, intervalMs);
  tick();
  return () => clearInterval(timer);
}
