import Fastify, { type FastifyInstance } from "fastify";
import type { PrismaClient } from "@prisma/client";
import type { Redis } from "ioredis";
import type { Env } from "./config/env.js";
import type { BotRuntimeManager } from "./modules/bots/bot-runtime-manager.js";
import { registerAdminRoutes } from "./modules/admin/admin.routes.js";
import type { BroadcastScheduler } from "./modules/broadcast/scheduler.js";
import { registerTelegramWebhookRoute } from "./webhook.js";

export function buildApp(
  env: Env,
  prisma: PrismaClient,
  redis: Redis,
  runtimeManager: BotRuntimeManager,
  broadcast: BroadcastScheduler | null = null,
): FastifyInstance {
  const app = Fastify({ logger: true });

  app.get("/health", async () => ({ ok: true }));
  registerAdminRoutes(app, env, prisma, { broadcast });
  registerTelegramWebhookRoute(app, runtimeManager, env);

  app.addHook("onClose", async () => {
    await redis.quit();
    await prisma.$disconnect();
  });

  return app;
}
