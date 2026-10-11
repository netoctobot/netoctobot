import assert from "node:assert/strict";
import test from "node:test";
import { publishOwnerBroadcastCampaign } from "./owner-publish.js";
import type { PrismaClient } from "@prisma/client";
import type { BroadcastScheduler } from "../scheduler.js";
import type { BroadcastRequest } from "../service.js";

const request: BroadcastRequest = {
  text: "hi",
  contentKind: "TEXT",
  caption: null,
  linkButtons: null,
  mediaUploadId: null,
  audienceType: "BOT_USERS",
  targetMode: "SELECTED",
  botIds: ["bot-1"],
  scope: { includeActive: true, includeInactive: false, includeDeleted: false },
  includeBotOwners: false,
};

test("publishOwnerBroadcastCampaign reuses campaign for publishNonce without recreating", async () => {
  let createCalls = 0;
  const prisma = {
    user: {
      findUnique: async () => ({ id: "user-1" }),
    },
    bot: {
      findUnique: async () => ({
        id: "bot-1",
        ownerId: "user-1",
        isActive: true,
        deletedAt: null,
      }),
      findMany: async () => [{ id: "bot-1" }],
    },
    broadcastCampaign: {
      findUnique: async () => ({ id: "existing-campaign" }),
      create: async () => {
        createCalls += 1;
        return { id: "new-campaign" };
      },
    },
    broadcastDelivery: {
      findMany: async () => [{ id: "d1" }],
    },
  } as unknown as PrismaClient;
  const scheduler = {
    enqueue: async () => undefined,
  } as unknown as BroadcastScheduler;
  const redis = {
    del: async () => 1,
    set: async () => "OK",
  };
  const result = await publishOwnerBroadcastCampaign({
    prisma,
    redis: redis as never,
    scheduler,
    botId: "bot-1",
    ownerTelegramId: 42,
    publishNonce: "nonce-1",
    request,
    probe: async () => ({ ok: true }),
    tokenValid: async () => true,
  });
  assert.equal(result.campaignId, "existing-campaign");
  assert.equal(createCalls, 0);
});
