import assert from "node:assert/strict";
import test from "node:test";
import { enqueuePendingCampaignDeliveries } from "./owner-publish.js";
import type { PrismaClient } from "@prisma/client";
import type { BroadcastScheduler } from "../scheduler.js";

test("enqueuePendingCampaignDeliveries schedules each pending delivery", async () => {
  const enqueued: string[] = [];
  const prisma = {
    broadcastDelivery: {
      findMany: async () => [{ id: "d1" }, { id: "d2" }],
    },
  } as unknown as PrismaClient;
  const scheduler = {
    enqueue: async (_campaignId: string, deliveryId: string) => {
      enqueued.push(deliveryId);
    },
  } as unknown as BroadcastScheduler;
  const ids = await enqueuePendingCampaignDeliveries(prisma, scheduler, "c1");
  assert.deepEqual(ids, ["d1", "d2"]);
  assert.deepEqual(enqueued, ["d1", "d2"]);
});

test("enqueuePendingCampaignDeliveries continues when one enqueue fails", async () => {
  const enqueued: string[] = [];
  const prisma = {
    broadcastDelivery: {
      findMany: async () => [{ id: "d1" }, { id: "d2" }],
    },
  } as unknown as PrismaClient;
  const scheduler = {
    enqueue: async (_campaignId: string, deliveryId: string) => {
      if (deliveryId === "d1") {
        throw new Error("redis_down");
      }
      enqueued.push(deliveryId);
    },
  } as unknown as BroadcastScheduler;
  const ids = await enqueuePendingCampaignDeliveries(prisma, scheduler, "c1");
  assert.deepEqual(ids, ["d1", "d2"]);
  assert.deepEqual(enqueued, ["d2"]);
});
