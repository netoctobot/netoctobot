import { timingSafeEqual } from "node:crypto";
import type { FastifyInstance } from "fastify";
import type { Update } from "grammy/types";
import type { Env } from "./config/env.js";
import type { PlatformBotRuntime } from "./bot.js";

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
  runtime: PlatformBotRuntime,
  env: Env,
): void {
  app.post<{
    Params: { botId: string };
    Body: Update;
  }>("/webhooks/telegram/:botId", async (request, reply) => {
    if (request.params.botId !== runtime.botRecord.id) {
      return reply.code(404).send({ error: "Not found" });
    }

    const providedSecret = request.headers[
      "x-telegram-bot-api-secret-token"
    ];
    if (
      typeof providedSecret !== "string" ||
      !secretsMatch(providedSecret, env.WEBHOOK_SECRET)
    ) {
      return reply.code(401).send({ error: "Unauthorized" });
    }

    await runtime.bot.handleUpdate(request.body);
    return reply.code(200).send({ ok: true });
  });
}
