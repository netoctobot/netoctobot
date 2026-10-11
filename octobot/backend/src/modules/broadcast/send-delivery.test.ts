import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import type { Api } from "grammy";
import { InputFile } from "grammy";
import type { PrismaClient } from "@prisma/client";
import { absolutePathForKey } from "./media-storage.js";
import { buildBroadcastLinkKeyboard, executeBroadcastSend, persistSentDelivery } from "./send-delivery.js";

const storageKey = "c".repeat(32);

async function withMediaFile(
  run: (input: { mediaRoot: string; api: Api; prisma: PrismaClient }) => Promise<void>,
): Promise<void> {
  const mediaRoot = await mkdtemp(path.join(tmpdir(), "broadcast-send-"));
  await writeFile(absolutePathForKey(mediaRoot, storageKey), Buffer.from("fake-binary"));
  const prisma = {
    broadcastMediaBotFile: {
      findUnique: async () => null,
    },
    $transaction: async (fn: (tx: PrismaClient) => Promise<void>) => {
      await fn(prisma as PrismaClient);
    },
    broadcastDelivery: {
      updateMany: async () => ({ count: 1 }),
    },
    broadcastDeliveryMessage: {
      create: async () => ({ id: "msg" }),
    },
  } as unknown as PrismaClient;
  try {
    await run({ mediaRoot, api: {} as Api, prisma });
  } finally {
    await rm(mediaRoot, { recursive: true, force: true });
  }
}

test("sendDocument uses stored originalName for xlsx pdf and zip uploads", async () => {
  const cases = ["report.xlsx", "file.pdf", "bundle.zip"];
  for (const originalName of cases) {
    await withMediaFile(async ({ mediaRoot, prisma }) => {
      let seenFilename: string | undefined;
      const api = {
        sendDocument: async (_chatId: number, source: InputFile | string) => {
          assert.ok(source instanceof InputFile);
          seenFilename = source.filename;
          return {
            message_id: 1,
            document: { file_id: "doc_id", file_unique_id: "doc_unique" },
          };
        },
      } as unknown as Api;
      const outcome = await executeBroadcastSend({
        prisma,
        api,
        mediaRoot,
        deliveryId: "d1",
        botId: "b1",
        chatId: -100123,
        content: {
          contentKind: "DOCUMENT",
          text: "",
          caption: null,
          linkButtons: null,
          mediaAsset: {
            id: "m1",
            storageKey,
            contentKind: "DOCUMENT",
            originalName,
          },
        },
      });
      assert.equal(outcome.status, "sent");
      assert.equal(seenFilename, originalName);
    });
  }
});

test("sendDocument with cached file_id does not re-upload stream", async () => {
  await withMediaFile(async ({ mediaRoot, prisma }) => {
    const prismaWithCache = {
      ...prisma,
      broadcastMediaBotFile: {
        findUnique: async () => ({ telegramFileId: "cached_doc_id" }),
      },
    } as unknown as PrismaClient;
    let sourceKind: string | undefined;
    const api = {
      sendDocument: async (_chatId: number, source: InputFile | string) => {
        sourceKind = typeof source === "string" ? "file_id" : "input";
        return {
          message_id: 2,
          document: { file_id: "cached_doc_id", file_unique_id: "u" },
        };
      },
    } as unknown as Api;
    const outcome = await executeBroadcastSend({
      prisma: prismaWithCache,
      api,
      mediaRoot,
      deliveryId: "d2",
      botId: "b1",
      chatId: -100123,
      content: {
        contentKind: "DOCUMENT",
        text: "",
        caption: null,
        linkButtons: null,
        mediaAsset: {
          id: "m1",
          storageKey,
          contentKind: "DOCUMENT",
          originalName: "report.xlsx",
        },
      },
    });
    assert.equal(outcome.status, "sent");
    assert.equal(sourceKind, "file_id");
  });
});

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

test("buildBroadcastLinkKeyboard applies Telegram button styles", () => {
  const keyboard = buildBroadcastLinkKeyboard([
    [
      { text: "A", url: "https://a.test" },
      { text: "B", url: "https://b.test", style: "primary" },
    ],
    [{ text: "C", url: "https://c.test", style: "success" }],
  ]);
  assert.ok(keyboard);
  assert.deepEqual(keyboard!.inline_keyboard, [
    [
      { text: "A", url: "https://a.test" },
      { text: "B", url: "https://b.test", style: "primary" },
    ],
    [{ text: "C", url: "https://c.test", style: "success" }],
  ]);
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
