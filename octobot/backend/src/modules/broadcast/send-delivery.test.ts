import assert from "node:assert/strict";
import test from "node:test";
import type { PrismaClient } from "@prisma/client";
import { persistSentDelivery } from "./send-delivery.js";

test("persistSentDelivery returns uncertain when delivery row cannot be updated", async () => {
  const prisma = {
    $transaction: async () => {
      throw new Error("db_down");
    },
    broadcastMediaBotFile: {
      upsert: async () => ({}),
    },
  } as unknown as PrismaClient;
  const result = await persistSentDelivery({
    prisma,
    deliveryId: "d1",
    chatId: 1,
    messageId: 2,
    mediaAssetId: "m1",
    botId: "b1",
    telegramFileId: "file",
  });
  assert.equal(result, "uncertain");
});

test("persistSentDelivery still ok when optional file_id cache fails", async () => {
  const prisma = {
    $transaction: async (fn: (tx: PrismaClient) => Promise<void>) => {
      await fn(prisma);
    },
    broadcastDelivery: {
      updateMany: async () => ({ count: 1 }),
    },
    broadcastDeliveryMessage: {
      create: async () => ({ id: "msg" }),
    },
    broadcastMediaBotFile: {
      upsert: async () => {
        throw new Error("cache_failed");
      },
    },
  } as unknown as PrismaClient;
  const result = await persistSentDelivery({
    prisma,
    deliveryId: "d1",
    chatId: 1,
    messageId: 2,
    mediaAssetId: "m1",
    botId: "b1",
    telegramFileId: "file",
  });
  assert.equal(result, "ok");
});
