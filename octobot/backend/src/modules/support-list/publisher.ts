import {
  Prisma,
  SupportListCycleStatus,
  SupportListPublicationStatus,
  SupportedLanguage,
  type PrismaClient,
} from "@prisma/client";
import { GrammyError, InlineKeyboard, type Bot as TelegramBot } from "grammy";
import { TelegramUnavailableError, checkBotChannelRights, resolveChannelOpenUrl, retryAfterMs } from "./access.js";
import { isPublishable } from "./eligibility.js";
import { channelDisplayName, nextRotationOffset, parseRenderedList, renderSupportList, rotateEntries, type RenderedList } from "./render.js";
import { isStaleCycle } from "./schedule.js";
import { translate } from "../localization/localization.service.js";

export interface PublishDeps {
  prisma: PrismaClient;
  openTelegram: (tokenEncrypted: string) => Promise<TelegramBot>;
  enqueueDelete: (publicationId: string, deleteAt: Date) => Promise<void>;
}

type BuiltList =
  | { kind: "ready"; rendered: RenderedList; rotationCount: number }
  | { kind: "empty" }
  | { kind: "unfit" }
  | { kind: "unavailable" };

async function buildCurrentList(
  prisma: PrismaClient,
  telegram: TelegramBot,
  botId: string,
  listName: string,
  format: "TEXT" | "BUTTONS",
  rotationOffset: number,
): Promise<BuiltList> {
  const memberships = await prisma.supportListMembership.findMany({
    where: { botId, deletedAt: null, acceptanceStatus: "ACCEPTED" },
    include: { channel: true },
    orderBy: { createdAt: "asc" },
  });
  const eligible = memberships.filter((membership) =>
    isPublishable(membership),
  );
  const ordered = rotateEntries(eligible, rotationOffset);
  const entries = [];
  for (const membership of ordered) {
    const opened = await resolveChannelOpenUrl(telegram, {
      channelTelegramId: membership.channelTelegramId,
      username: membership.channel.username,
    });
    if (opened.kind === "unavailable") {
      return { kind: "unavailable" };
    }
    if (opened.kind === "invite_disabled") {
      await prisma.supportListMembership.update({
        where: { id: membership.id },
        data: { inviteUnavailable: true },
      });
      continue;
    }
    entries.push({
      id: membership.id,
      title: channelDisplayName(membership.channel),
      url: opened.url,
    });
  }
  const rendered = renderSupportList({ listName, entries, format });
  if (!rendered.ok) {
    return { kind: rendered.reason === "empty" ? "empty" : "unfit" };
  }
  return {
    kind: "ready",
    rendered: rendered.rendered,
    rotationCount: entries.length,
  };
}

function keyboardFor(rendered: RenderedList): InlineKeyboard | undefined {
  if (!rendered.buttons) {
    return undefined;
  }
  const keyboard = new InlineKeyboard();
  for (const button of rendered.buttons) {
    keyboard.url(button.label, button.url).row();
  }
  return keyboard;
}

export async function previewSupportList(
  prisma: PrismaClient,
  telegram: TelegramBot,
  botId: string,
): Promise<BuiltList> {
  const settings = await prisma.supportListSettings.findUniqueOrThrow({
    where: { botId },
  });
  return buildCurrentList(
    prisma,
    telegram,
    botId,
    settings.listName,
    settings.format,
    settings.rotationOffset,
  );
}

async function notifyOwner(
  telegram: TelegramBot,
  ownerTelegramId: bigint,
  text: string,
): Promise<void> {
  await telegram.api.sendMessage(Number(ownerTelegramId), text).catch(() => undefined);
}

export async function publishCycle(
  deps: PublishDeps,
  cycleId: string,
  now = new Date(),
): Promise<void> {
  const cycle = await deps.prisma.supportListCycle.findUnique({
    where: { id: cycleId },
    include: {
      settings: { include: { bot: { include: { owner: true } } } },
    },
  });
  if (!cycle) {
    return;
  }
  if (
    cycle.status === SupportListCycleStatus.PUBLISHED ||
    cycle.status === SupportListCycleStatus.SKIPPED ||
    cycle.status === SupportListCycleStatus.FAILED
  ) {
    return;
  }
  const { settings } = cycle;
  const bot = settings.bot;
  if (
    cycle.status === SupportListCycleStatus.PENDING &&
    (isStaleCycle(cycle.scheduledAt, cycle.deleteAt, now) ||
      !bot.isActive ||
      bot.deletedAt ||
      !settings.publishingEnabled)
  ) {
    await deps.prisma.supportListCycle.update({
      where: { id: cycle.id },
      data: { status: SupportListCycleStatus.SKIPPED },
    });
    return;
  }

  const telegram = await deps.openTelegram(bot.tokenEncrypted);
  let rendered = parseRenderedList(cycle.snapshot);
  if (!rendered) {
    const built = await buildCurrentList(
      deps.prisma,
      telegram,
      bot.id,
      settings.listName,
      settings.format,
      settings.rotationOffset,
    );
    if (built.kind === "unavailable") {
      throw new TelegramUnavailableError();
    }
    if (built.kind === "empty") {
      await deps.prisma.supportListCycle.updateMany({
        where: { id: cycle.id, status: SupportListCycleStatus.PENDING },
        data: { status: SupportListCycleStatus.SKIPPED },
      });
      return;
    }
    if (built.kind === "unfit") {
      if (!cycle.ownerNotified) {
        const preference = await deps.prisma.userBotPreference.findUnique({
          where: {
            userId_botId: { userId: bot.ownerId, botId: bot.id },
          },
          select: { language: true },
        });
        await notifyOwner(
          telegram,
          bot.owner.telegramId,
          translate(
            preference?.language ?? SupportedLanguage.EN,
            "supportList.publishUnfit",
            { listName: settings.listName },
          ),
        );
      }
      await deps.prisma.supportListCycle.updateMany({
        where: { id: cycle.id, status: SupportListCycleStatus.PENDING },
        data: {
          status: SupportListCycleStatus.FAILED,
          ownerNotified: true,
        },
      });
      return;
    }
    const claimed = await deps.prisma.supportListCycle.updateMany({
      where: { id: cycle.id, status: SupportListCycleStatus.PENDING },
      data: {
        status: SupportListCycleStatus.PUBLISHING,
        snapshot: built.rendered as unknown as Prisma.InputJsonValue,
        rotationOffset: settings.rotationOffset,
        sealedAt: now,
      },
    });
    if (claimed.count === 1) {
      await deps.prisma.supportListSettings.update({
        where: { id: settings.id },
        data: {
          rotationOffset: nextRotationOffset(
            settings.rotationOffset,
            built.rotationCount,
          ),
        },
      });
    }
    rendered = built.rendered;
  }

  const markup = keyboardFor(rendered);
  for (const membershipId of rendered.memberIds) {
    const publication = await deps.prisma.supportListPublication.upsert({
      where: {
        cycleId_membershipId: { cycleId: cycle.id, membershipId },
      },
      create: {
        cycleId: cycle.id,
        membershipId,
        channelTelegramId: 0n,
        deleteAt: cycle.deleteAt,
        status: SupportListPublicationStatus.PENDING,
      },
      update: {},
    });
    if (
      publication.messageId ||
      publication.status === SupportListPublicationStatus.SENT ||
      publication.status === SupportListPublicationStatus.SKIPPED ||
      publication.status === SupportListPublicationStatus.DELETED
    ) {
      continue;
    }
    const membership = await deps.prisma.supportListMembership.findUnique({
      where: { id: membershipId },
    });
    if (!membership || !isPublishable(membership)) {
      await deps.prisma.supportListPublication.update({
        where: { id: publication.id },
        data: { status: SupportListPublicationStatus.SKIPPED },
      });
      continue;
    }
    if (publication.channelTelegramId !== membership.channelTelegramId) {
      await deps.prisma.supportListPublication.update({
        where: { id: publication.id },
        data: { channelTelegramId: membership.channelTelegramId },
      });
    }
    const rights = await checkBotChannelRights(
      telegram,
      Number(membership.channelTelegramId),
    );
    if (rights.kind === "unavailable") {
      throw new TelegramUnavailableError();
    }
    if (rights.kind === "lost") {
      await deps.prisma.supportListMembership.update({
        where: { id: membership.id },
        data: { permissionsLost: true },
      });
      await deps.prisma.supportListPublication.update({
        where: { id: publication.id },
        data: { status: SupportListPublicationStatus.SKIPPED },
      });
      continue;
    }
    try {
      const message = await telegram.api.sendMessage(
        Number(membership.channelTelegramId),
        rendered.text,
        markup
          ? { reply_markup: markup }
          : { link_preview_options: { is_disabled: true } },
      );
      await deps.prisma.supportListPublication.update({
        where: { id: publication.id },
        data: {
          messageId: BigInt(message.message_id),
          status: SupportListPublicationStatus.SENT,
          channelTelegramId: membership.channelTelegramId,
        },
      });
      await deps.enqueueDelete(publication.id, cycle.deleteAt);
    } catch (error) {
      if (retryAfterMs(error) !== null) {
        throw error;
      }
      if (
        error instanceof GrammyError &&
        error.error_code < 500 &&
        error.error_code !== 429
      ) {
        await deps.prisma.supportListPublication.update({
          where: { id: publication.id },
          data: { status: SupportListPublicationStatus.FAILED },
        });
        continue;
      }
      throw error;
    }
  }

  await deps.prisma.supportListCycle.updateMany({
    where: {
      id: cycle.id,
      status: {
        in: [
          SupportListCycleStatus.PUBLISHING,
          SupportListCycleStatus.PENDING,
        ],
      },
    },
    data: { status: SupportListCycleStatus.PUBLISHED },
  });
}

export async function deletePublishedMessage(
  deps: Pick<PublishDeps, "prisma" | "openTelegram">,
  publicationId: string,
): Promise<void> {
  const publication = await deps.prisma.supportListPublication.findUnique({
    where: { id: publicationId },
    include: {
      cycle: { include: { settings: { include: { bot: true } } } },
    },
  });
  if (!publication?.messageId) {
    return;
  }
  if (publication.status === SupportListPublicationStatus.DELETED) {
    return;
  }
  const telegram = await deps.openTelegram(
    publication.cycle.settings.bot.tokenEncrypted,
  );
  try {
    await telegram.api.deleteMessage(
      Number(publication.channelTelegramId),
      Number(publication.messageId),
    );
    await deps.prisma.supportListPublication.update({
      where: { id: publication.id },
      data: { status: SupportListPublicationStatus.DELETED },
    });
  } catch (error) {
    if (retryAfterMs(error) !== null) {
      throw error;
    }
    const description =
      error instanceof GrammyError ? error.description.toLowerCase() : "";
    if (
      description.includes("message to delete not found") ||
      description.includes("message can't be deleted")
    ) {
      await deps.prisma.supportListPublication.update({
        where: { id: publication.id },
        data: { status: SupportListPublicationStatus.DELETED },
      });
      return;
    }
    throw error;
  }
}

export async function markDeleteFailed(
  prisma: PrismaClient,
  publicationId: string,
): Promise<void> {
  await prisma.supportListPublication.updateMany({
    where: {
      id: publicationId,
      status: { not: SupportListPublicationStatus.DELETED },
    },
    data: { status: SupportListPublicationStatus.DELETE_FAILED },
  });
}
