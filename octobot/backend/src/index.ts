import { buildApp } from "./app.js";
import { createPlatformBotRuntime } from "./bot.js";
import { loadEnv } from "./config/env.js";
import { createPrismaClient } from "./lib/prisma.js";
import { createRedisClient } from "./lib/redis.js";
import { BotRuntimeManager } from "./modules/bots/bot-runtime-manager.js";

const env = loadEnv();
const prisma = createPrismaClient();
const redis = createRedisClient(env.REDIS_URL);
const runtimeManager = new BotRuntimeManager(env, prisma, redis);

let app: ReturnType<typeof buildApp> | undefined;

try {
  await redis.connect();
  const runtime = await createPlatformBotRuntime(
    env,
    prisma,
    runtimeManager,
    redis,
  );
  runtimeManager.add(runtime);
  await runtimeManager.loadActiveUserBots();

  app = buildApp(env, prisma, redis, runtimeManager);
  await app.listen({ port: env.PORT, host: "0.0.0.0" });
  await runtimeManager.registerAllWebhooks();

  app.log.info(
    {
      botId: runtime.botRecord.id,
      botUsername: runtime.botRecord.botUsername,
      webhookRegistration: env.WEBHOOK_REGISTRATION_ENABLED,
    },
    "Platform bot is ready",
  );
} catch (error) {
  await runtimeManager.shutdown();
  if (app) {
    await app.close();
  } else {
    await redis.quit();
    await prisma.$disconnect();
  }
  throw error;
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, async () => {
    await runtimeManager.shutdown();
    await app?.close();
    process.exit(0);
  });
}
