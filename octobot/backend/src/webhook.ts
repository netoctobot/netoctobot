import { timingSafeEqual } from "node:crypto";
import type { FastifyInstance } from "fastify";
import type { Update } from "grammy/types";
import type { Env } from "./config/env.js";
import {
  type BotRuntimeManager,
  deriveWebhookSecret,
} from "./modules/bots/bot-runtime-manager.js";

function secretsMatch(actual: string | undefined, expected: string): boolean {
  if (!actual) {
    return false;
  }
  const actualBuffer = Buffer.from(actual);
  const expectedBuffer = Buffer.from(expected);
  return (
    actualBuffer.length === expectedBuffer.length &&
    timingSafeEqual(actualBuffer, expectedBuffer)
  );
}

export function registerTelegramWebhookRoute(
  app: FastifyInstance,
  runtimeManager: BotRuntimeManager,
  env: Env,
): void {
  app.post<{
    Params: { botId: string };
    Body: Update;
  }>("/webhooks/telegram/:botId", async (request, reply) => {
    const runtime = runtimeManager.get(request.params.botId);
    if (!runtime) {
      return reply.code(404).send({ error: "Not found" });
    }

    const providedSecret = request.headers[
      "x-telegram-bot-api-secret-token"
    ];
    if (
      typeof providedSecret !== "string" ||
      !secretsMatch(
        providedSecret,
        deriveWebhookSecret(env.WEBHOOK_SECRET, request.params.botId),
      )
    ) {
      return reply.code(401).send({ error: "Unauthorized" });
    }

    await runtime.bot.handleUpdate(request.body);
    return reply.code(200).send({ ok: true });
  });
}
