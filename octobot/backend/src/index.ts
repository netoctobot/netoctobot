import { buildApp } from "./app.js";
import { createPlatformBotRuntime } from "./bot.js";
import { loadEnv } from "./config/env.js";
import { createPrismaClient } from "./lib/prisma.js";
import { createRedisClient } from "./lib/redis.js";
import { bootstrapLocalDashboardAdmin } from "./modules/admin/bootstrap-admin.js";
import { BotRuntimeManager } from "./modules/bots/bot-runtime-manager.js";
import { startMediaCleanupLoop } from "./modules/broadcast/media-cleanup.js";
import { ensureMediaRoot } from "./modules/broadcast/media-storage.js";
import { BroadcastScheduler } from "./modules/broadcast/scheduler.js";
import { SupportListScheduler } from "./modules/support-list/scheduler.js";

const env = loadEnv();
const prisma = createPrismaClient();
const redis = createRedisClient(env.REDIS_URL);
const broadcastScheduler = new BroadcastScheduler(env, prisma);
const runtimeManager = new BotRuntimeManager(env, prisma, redis, broadcastScheduler);
const supportListScheduler = new SupportListScheduler(env, prisma);
let app: Awaited<ReturnType<typeof buildApp>> | undefined;
let stopMediaCleanup: (() => void) | undefined;

try {
  await redis.connect();
  await bootstrapLocalDashboardAdmin(prisma, env, (message) => {
    console.warn(message);
  });
  const runtime = await createPlatformBotRuntime(
    env,
    prisma,
    runtimeManager,
    redis,
  );
  runtimeManager.add(runtime);
  await runtimeManager.loadActiveUserBots();

  await ensureMediaRoot(env.BROADCAST_MEDIA_DIR);
  app = await buildApp(env, prisma, redis, runtimeManager, broadcastScheduler);
  stopMediaCleanup = startMediaCleanupLoop(prisma, env.BROADCAST_MEDIA_DIR);
  await app.listen({ port: env.PORT, host: "0.0.0.0" });
  await runtimeManager.registerAllWebhooks();
  await supportListScheduler.start();

  app.log.info(
    {
      botId: runtime.botRecord.id,
      botUsername: runtime.botRecord.botUsername,
      webhookRegistration: env.WEBHOOK_REGISTRATION_ENABLED,
    },
    "Platform bot is ready",
  );
} catch (error) {
  stopMediaCleanup?.();
  await supportListScheduler.stop().catch(() => undefined);
  await broadcastScheduler.stop().catch(() => undefined);
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
    stopMediaCleanup?.();
    await supportListScheduler.stop().catch(() => undefined);
    await broadcastScheduler.stop().catch(() => undefined);
    await runtimeManager.shutdown();
    await app?.close();
    process.exit(0);
  });
}
