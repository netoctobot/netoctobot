import type { Bot } from "grammy";
import type { PrismaClient } from "@prisma/client";
import {
  recordPrivateBotInteraction,
  type TelegramUserProfile,
} from "./user.service.js";

export function attachPrivateChatRecorder(
  bot: Bot,
  input: {
    prisma: PrismaClient;
    botId: () => string;
    bypass?: () => boolean;
  },
): void {
  bot.use(async (context, next) => {
    if (
      context.chat?.type === "private" &&
      context.from &&
      !(input.bypass?.() ?? false)
    ) {
      await recordPrivateBotInteraction(
        input.prisma,
        context.from as TelegramUserProfile,
        input.botId(),
      ).catch(() => undefined);
    }
    await next();
  });
}
