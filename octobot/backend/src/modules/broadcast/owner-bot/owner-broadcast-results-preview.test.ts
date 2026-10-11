import assert from "node:assert/strict";
import test from "node:test";
import { SupportedLanguage } from "@prisma/client";
import type { Context } from "grammy";
import type { Redis } from "ioredis";
import type { ManagedBotRuntime } from "../../bots/bot-runtime-manager.js";
import { showOwnerBroadcastResultsPanel } from "./owner-broadcast-preview.js";

test("showOwnerBroadcastResultsPanel sends a new text message and removes old media panel", async () => {
  const redisStore = new Map<string, string>([
    [
      "bot:dashboard:bot-1:42",
      JSON.stringify({ chatId: 100, messageId: 50 }),
    ],
  ]);
  const redis = {
    get: async (key: string) => redisStore.get(key) ?? null,
    set: async (key: string, value: string) => {
      redisStore.set(key, value);
      return "OK";
    },
  } as unknown as Redis;
  let deleted: number | null = null;
  let sentText = "";
  const context = {
    from: { id: 42 },
    chat: { id: 100 },
    api: {
      sendMessage: async (_chatId: number, text: string) => {
        sentText = text;
        return { message_id: 99 };
      },
      deleteMessage: async (_chatId: number, messageId: number) => {
        deleted = messageId;
        return true;
      },
    },
  } as unknown as Context;
  const runtime = {
    botRecord: { id: "bot-1" },
  } as ManagedBotRuntime;
  const ok = await showOwnerBroadcastResultsPanel({
    context,
    runtime,
    redis,
    language: SupportedLanguage.EN,
    summaryText: "sent: 1",
  });
  assert.equal(ok, true);
  assert.ok(sentText.includes("sent: 1"));
  assert.equal(deleted, 50);
  const saved = JSON.parse(redisStore.get("bot:dashboard:bot-1:42") ?? "{}");
  assert.equal(saved.messageId, 99);
});
