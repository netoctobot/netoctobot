import assert from "node:assert/strict";
import test from "node:test";
import { SupportedLanguage } from "@prisma/client";
import type { Context } from "grammy";
import type { PrismaClient } from "@prisma/client";
import type { Redis } from "ioredis";
import type { ManagedBotRuntime } from "../../bots/bot-runtime-manager.js";
import { applyPostPublishUi } from "./register-owner-broadcast.js";
import type { OwnerBroadcastDeps } from "./register-owner-broadcast.js";
import type { BroadcastScheduler } from "../scheduler.js";
import type { Env } from "../../../config/env.js";

test("applyPostPublishUi alerts when results panel cannot be shown after successful publish", async () => {
  const alerts: string[] = [];
  const prisma = {
    broadcastDelivery: {
      groupBy: async () => [{ status: "SENT", _count: { _all: 1 } }],
    },
  } as unknown as PrismaClient;
  const deps: OwnerBroadcastDeps = {
    prisma,
    redis: { get: async () => null, set: async () => "OK" } as unknown as Redis,
    env: { ENCRYPTION_KEY: "0".repeat(64), BROADCAST_MEDIA_DIR: "/tmp" } as Env,
    scheduler: { enqueue: async () => undefined } as unknown as BroadcastScheduler,
    showDashboard: async () => undefined,
    editDashboard: async () => undefined,
    isOwner: async () => true,
    goHome: async () => undefined,
  };
  const context = {
    from: { id: 42 },
    chat: { id: 100 },
    api: {
      sendMessage: async () => {
        throw new Error("editMessageText failed");
      },
    },
    answerCallbackQuery: async (opts?: { text?: string }) => {
      if (opts?.text) {
        alerts.push(opts.text);
      }
      return true;
    },
  } as unknown as Context;
  const runtime = { botRecord: { id: "bot-1" } } as ManagedBotRuntime;

  await applyPostPublishUi(
    deps,
    context,
    runtime,
    "campaign-1",
    SupportedLanguage.EN,
  );

  assert.equal(alerts.length, 1);
  assert.match(alerts[0], /Broadcast started/i);
});
