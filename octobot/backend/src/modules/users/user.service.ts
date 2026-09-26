import {
  type PrismaClient,
  type User,
  type UserBotPreference,
  SupportedLanguage,
} from "@prisma/client";
import { normalizeTelegramLanguage } from "../localization/localization.service.js";

export interface TelegramUserProfile {
  id: number;
  username?: string;
  first_name: string;
  last_name?: string;
  language_code?: string;
}

export interface UserBotContext {
  user: User;
  preference: UserBotPreference;
}

export async function syncBotUser(
  prisma: PrismaClient,
  profile: TelegramUserProfile,
  botId: string,
): Promise<UserBotContext> {
  return prisma.$transaction(async (transaction) => {
    const user = await transaction.user.upsert({
      where: { telegramId: BigInt(profile.id) },
      create: {
        telegramId: BigInt(profile.id),
        username: profile.username ?? null,
        firstName: profile.first_name,
        lastName: profile.last_name ?? null,
      },
      update: {
        username: profile.username ?? null,
        firstName: profile.first_name,
        lastName: profile.last_name ?? null,
        deletedAt: null,
      },
    });

    const preference = await transaction.userBotPreference.upsert({
      where: {
        userId_botId: {
          userId: user.id,
          botId,
        },
      },
      create: {
        userId: user.id,
        botId,
        language: normalizeTelegramLanguage(profile.language_code),
        isExplicit: false,
      },
      update: {},
    });

    return { user, preference };
  });
}

export async function setExplicitLanguage(
  prisma: PrismaClient,
  userId: string,
  botId: string,
  language: SupportedLanguage,
): Promise<UserBotPreference> {
  return prisma.userBotPreference.update({
    where: {
      userId_botId: { userId, botId },
    },
    data: {
      language,
      isExplicit: true,
    },
  });
}
