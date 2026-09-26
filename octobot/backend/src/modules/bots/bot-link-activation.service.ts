import { LinkStatus, type PrismaClient } from "@prisma/client";
import { GrammyError, type Bot as TelegramBot } from "grammy";
import { classifyChannelMembership } from "../channels/channel-membership.js";

export interface BotLinkActivationResult {
  verified: number;
  restored: number;
  deactivated: number;
}

function isDefinitivelyUnavailable(error: unknown): boolean {
  return (
    error instanceof GrammyError &&
    (error.error_code === 400 || error.error_code === 403)
  );
}

export async function reconcileBotLinksForActivation(
  prisma: PrismaClient,
  telegramBot: TelegramBot,
  botId: string,
): Promise<BotLinkActivationResult> {
  const links = await prisma.botChannelLink.findMany({
    where: {
      botId,
      channel: { deletedAt: null },
      OR: [
        { status: LinkStatus.ACTIVE },
        { deactivationReason: "BOT_DEACTIVATED" },
      ],
    },
    select: {
      id: true,
      status: true,
      deactivationReason: true,
      channel: { select: { channelTelegramId: true } },
    },
  });

  const outcomes = await Promise.all(
    links.map(async (link) => {
      try {
        const membership = await telegramBot.api.getChatMember(
          Number(link.channel.channelTelegramId),
          telegramBot.botInfo.id,
        );
        return {
          link,
          outcome: classifyChannelMembership(membership),
        };
      } catch (error) {
        if (!isDefinitivelyUnavailable(error)) {
          throw error;
        }
        return { link, outcome: "BOT_REMOVED" as const };
      }
    }),
  );

  let restored = 0;
  let deactivated = 0;
  await prisma.$transaction(async (transaction) => {
    for (const { link, outcome } of outcomes) {
      if (outcome === "VALID") {
        if (
          link.status === LinkStatus.INACTIVE &&
          link.deactivationReason === "BOT_DEACTIVATED"
        ) {
          await transaction.botChannelLink.update({
            where: { id: link.id },
            data: {
              status: LinkStatus.ACTIVE,
              deactivatedAt: null,
              deactivationReason: null,
            },
          });
          restored += 1;
        }
        continue;
      }

      await transaction.botChannelLink.update({
        where: { id: link.id },
        data: {
          status: LinkStatus.INACTIVE,
          deactivatedAt: new Date(),
          deactivationReason: outcome,
        },
      });
      deactivated += 1;
    }
  });

  return {
    verified: outcomes.length,
    restored,
    deactivated,
  };
}
