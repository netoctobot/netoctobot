import Fastify, { type FastifyInstance } from "fastify";
import type { PrismaClient } from "@prisma/client";
import type { Env } from "./config/env.js";
import type { PlatformBotRuntime } from "./bot.js";
import { registerTelegramWebhookRoute } from "./webhook.js";

export function buildApp(
  env: Env,
  prisma: PrismaClient,
  runtime: PlatformBotRuntime,
): FastifyInstance {
  const app = Fastify({ logger: true });

  app.get("/health", async () => ({ ok: true }));
  registerTelegramWebhookRoute(app, runtime, env);

  app.addHook("onClose", async () => {
    await prisma.$disconnect();
  });

  return app;
}
