import { buildApp } from "./app.js";
import {
  createPlatformBotRuntime,
  registerPlatformWebhook,
} from "./bot.js";
import { loadEnv } from "./config/env.js";
import { createPrismaClient } from "./lib/prisma.js";

const env = loadEnv();
const prisma = createPrismaClient();

let app: ReturnType<typeof buildApp> | undefined;

try {
  const runtime = await createPlatformBotRuntime(env, prisma);
  app = buildApp(env, prisma, runtime);
  await app.listen({ port: env.PORT, host: "0.0.0.0" });
  await registerPlatformWebhook(runtime, env);

  app.log.info(
    {
      botId: runtime.botRecord.id,
      botUsername: runtime.botRecord.botUsername,
      webhookRegistration: env.WEBHOOK_REGISTRATION_ENABLED,
    },
    "Platform bot is ready",
  );
} catch (error) {
  if (app) {
    await app.close();
  } else {
    await prisma.$disconnect();
  }
  throw error;
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, async () => {
    await app?.close();
    process.exit(0);
  });
}
