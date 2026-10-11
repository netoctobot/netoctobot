import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import type { PrismaClient } from "@prisma/client";
import { cleanupFinishedCampaignMedia, cleanupOrphanUploads } from "./media-cleanup.js";
import { absolutePathForKey } from "./media-storage.js";

test("cleanupOrphanUploads removes only unlinked expired uploads", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "broadcast-orphan-"));
  const storageKey = "a".repeat(32);
  await writeFile(absolutePathForKey(root, storageKey), "data");
  let deleted = false;
  const prisma = {
    broadcastMediaAsset: {
      findMany: async () => [
        { id: "asset-1", storageKey },
      ],
      update: async () => {
        deleted = true;
        return {};
      },
    },
  } as unknown as PrismaClient;
  const count = await cleanupOrphanUploads(prisma, root, new Date("2026-03-01T00:00:00Z"));
  assert.equal(count, 1);
  assert.equal(deleted, true);
});

test("cleanupFinishedCampaignMedia skips campaigns with pending deliveries", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "broadcast-campaign-"));
  const storageKey = "b".repeat(32);
  await writeFile(absolutePathForKey(root, storageKey), "data");
  const prisma = {
    broadcastCampaign: {
      findMany: async () => [
        {
          id: "camp-1",
          mediaAsset: { id: "asset-1", storageKey, fileDeletedAt: null },
        },
      ],
      findFirst: async () => null,
    },
    broadcastDelivery: {
      count: async () => 1,
    },
    broadcastMediaAsset: {
      update: async () => {
        throw new Error("should not delete");
      },
    },
  } as unknown as PrismaClient;
  const count = await cleanupFinishedCampaignMedia(prisma, root, new Date("2026-06-01T00:00:00Z"));
  assert.equal(count, 0);
});
