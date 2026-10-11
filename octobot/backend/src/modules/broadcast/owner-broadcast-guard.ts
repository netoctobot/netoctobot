import type { PrismaClient } from "@prisma/client";
import type { BroadcastRequest } from "./service.js";

export class OwnerBroadcastAccessError extends Error {
  constructor(public readonly code: string) {
    super(code);
  }
}

export async function assertOwnerBotAccess(
  prisma: PrismaClient,
  botId: string,
  ownerTelegramId: bigint | number,
): Promise<{ userId: string; botId: string }> {
  const user = await prisma.user.findUnique({
    where: { telegramId: BigInt(ownerTelegramId) },
    select: { id: true },
  });
  if (!user) {
    throw new OwnerBroadcastAccessError("owner_not_found");
  }
  const bot = await prisma.bot.findUnique({
    where: { id: botId },
    select: { id: true, ownerId: true, isActive: true, deletedAt: true },
  });
  if (!bot || bot.ownerId !== user.id) {
    throw new OwnerBroadcastAccessError("bot_not_owned");
  }
  if (!bot.isActive || bot.deletedAt) {
    throw new OwnerBroadcastAccessError("bot_inactive");
  }
  return { userId: user.id, botId: bot.id };
}

export async function assertOwnerBotActiveForSend(
  prisma: PrismaClient,
  botId: string,
): Promise<boolean> {
  const bot = await prisma.bot.findUnique({
    where: { id: botId },
    select: { isActive: true, deletedAt: true },
  });
  return Boolean(bot?.isActive && !bot?.deletedAt);
}

export type OwnerAudience = "channels" | "users" | "both";

export function ownerAudienceToType(audience: OwnerAudience): BroadcastRequest["audienceType"] {
  switch (audience) {
    case "channels":
      return "CHANNELS";
    case "users":
      return "BOT_USERS";
    case "both":
      return "CHANNELS_AND_USERS";
  }
}

export function buildOwnerBroadcastRequest(
  botId: string,
  audience: OwnerAudience,
  content: Omit<BroadcastRequest, "audienceType" | "targetMode" | "botIds" | "scope" | "includeBotOwners">,
): BroadcastRequest {
  return {
    ...content,
    audienceType: ownerAudienceToType(audience),
    targetMode: "SELECTED",
    botIds: [botId],
    scope: { includeActive: true, includeInactive: false, includeDeleted: false },
    includeBotOwners: false,
  };
}
