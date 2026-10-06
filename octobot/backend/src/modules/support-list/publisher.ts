import {
  Prisma,
  SupportListCycleStatus,
  SupportListPublicationStatus,
  SupportedLanguage,
  type PrismaClient,
} from "@prisma/client";
import { GrammyError, InlineKeyboard, type Bot as TelegramBot } from "grammy";
import { TelegramUnavailableError, checkBotChannelRights, resolveChannelOpenUrl, retryAfterMs } from "./access.js";
import {
  classifySendFailure,
  occupiedUntil,
  PublishDeferredError,
} from "./delivery.js";
import { isPublishable } from "./eligibility.js";
import { channelDisplayName, nextRotationOffset, parseRenderedList, renderSupportList, rotateEntries, type RenderedList } from "./render.js";
import {
  capturedRetentionMinutes,
  deleteAtFromSuccessfulSend,
  shouldSkipBacklog,
} from "./schedule.js";
import { displayedListName } from "./contact-url.js";
import {
  MAX_RETENTION_MINUTES,
  MIN_RETENTION_MINUTES,
} from "./constants.js";
import { translate } from "../localization/localization.service.js";
import { persistChannelOpen } from "./membership.service.js";

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
      storedInviteUrl: membership.inviteUrl,
    });
    if (opened.kind === "unavailable") {
      return { kind: "unavailable" };
    }
    if (opened.kind !== "url" || opened.created) {
      await persistChannelOpen(
        prisma,
        {
          id: membership.id,
          inviteUnavailable: membership.inviteUnavailable,
          username: membership.channel.username,
        },
        opened,
      );
    }
    if (opened.kind !== "url") {
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
    displayedListName(settings.listName),
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

async function persistSentPublication(
  prisma: PrismaClient,
  publicationId: string,
  data: {
    messageId: bigint;
    deleteAt: Date;
    channelTelegramId: bigint;
  },
): Promise<boolean> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const saved = await prisma.supportListPublication.updateMany({
        where: {
          id: publicationId,
          status: SupportListPublicationStatus.SENDING,
          messageId: null,
        },
        data: {
          messageId: data.messageId,
          status: SupportListPublicationStatus.SENT,
          deleteAt: data.deleteAt,
          channelTelegramId: data.channelTelegramId,
        },
      });
      return saved.count === 1;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
  return false;
}

async function recordUnconfirmedDelivery(
  deps: PublishDeps,
  telegram: TelegramBot,
  input: {
    publicationId: string;
    ownerTelegramId: bigint;
    language: SupportedLanguage;
    listName: string;
    channelLabel: string;
    alreadyNotified: boolean;
  },
): Promise<void> {
  await deps.prisma.supportListPublication.updateMany({
    where: {
      id: input.publicationId,
      messageId: null,
      status: {
        in: [
          SupportListPublicationStatus.SENDING,
          SupportListPublicationStatus.PENDING,
        ],
      },
    },
    data: { status: SupportListPublicationStatus.UNCONFIRMED },
  });
  if (input.alreadyNotified) {
    return;
  }
  await notifyOwner(
    telegram,
    input.ownerTelegramId,
    translate(input.language, "supportList.unconfirmedDelivery", {
      listName: input.listName,
      channel: input.channelLabel,
    }),
  );
  await deps.prisma.supportListPublication.updateMany({
    where: { id: input.publicationId, ownerNotified: false },
    data: { ownerNotified: true },
  });
}

export async function countUnconfirmedPublications(
  prisma: PrismaClient,
  botId: string,
): Promise<number> {
  return prisma.supportListPublication.count({
    where: {
      status: SupportListPublicationStatus.UNCONFIRMED,
      cycle: { botId },
    },
  });
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
  const listName = displayedListName(settings.listName);
  const bot = settings.bot;
  if (
    cycle.status === SupportListCycleStatus.PENDING &&
    (shouldSkipBacklog(cycle.scheduledAt, now) ||
      !bot.isActive ||
      bot.deletedAt ||
      !settings.publishingEnabled)
  ) {
    await deps.prisma.supportListCycle.updateMany({
      where: {
        id: cycle.id,
        status: SupportListCycleStatus.PENDING,
      },
      data: { status: SupportListCycleStatus.SKIPPED },
    });
    return;
  }

  if (cycle.status === SupportListCycleStatus.PENDING) {
    const live = await deps.prisma.supportListPublication.findMany({
      where: {
        status: {
          in: [
            SupportListPublicationStatus.SENT,
            SupportListPublicationStatus.SENDING,
            SupportListPublicationStatus.UNCONFIRMED,
          ],
        },
        cycle: { botId: bot.id },
      },
      select: {
        cycleId: true,
        status: true,
        deleteAt: true,
        sendAttemptedAt: true,
        cycle: { select: { scheduledAt: true, deleteAt: true } },
      },
    });
    const resumeAt = occupiedUntil({
      publications: live.map((publication) => ({
        cycleId: publication.cycleId,
        status: publication.status,
        deleteAt: publication.deleteAt,
        sendAttemptedAt: publication.sendAttemptedAt,
        retentionMinutes: capturedRetentionMinutes(
          publication.cycle.scheduledAt,
          publication.cycle.deleteAt,
        ),
      })),
      currentCycleId: cycle.id,
      retentionMinutes: settings.retentionMinutes,
      now,
    });
    if (resumeAt) {
      throw new PublishDeferredError(resumeAt);
    }
  }

  const telegram = await deps.openTelegram(bot.tokenEncrypted);
  let rendered = parseRenderedList(cycle.snapshot);
  if (!rendered) {
    const built = await buildCurrentList(
      deps.prisma,
      telegram,
      bot.id,
      listName,
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
            { listName },
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
    if (claimed.count !== 1) {
      return;
    }
    await deps.prisma.supportListSettings.update({
      where: { id: settings.id },
      data: {
        rotationOffset: nextRotationOffset(
          settings.rotationOffset,
          built.rotationCount,
        ),
      },
    });
    rendered = built.rendered;
  }

  const markup = keyboardFor(rendered);
  const preference = await deps.prisma.userBotPreference.findUnique({
    where: { userId_botId: { userId: bot.ownerId, botId: bot.id } },
    select: { language: true },
  });
  const ownerLanguage = preference?.language ?? SupportedLanguage.EN;
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
      publication.status === SupportListPublicationStatus.SENT &&
      publication.messageId
    ) {
      await deps.enqueueDelete(publication.id, publication.deleteAt);
      continue;
    }
    if (
      publication.status === SupportListPublicationStatus.SKIPPED ||
      publication.status === SupportListPublicationStatus.DELETED ||
      publication.status === SupportListPublicationStatus.FAILED ||
      publication.status === SupportListPublicationStatus.DELETE_FAILED
    ) {
      continue;
    }
    if (
      publication.status === SupportListPublicationStatus.UNCONFIRMED ||
      publication.status === SupportListPublicationStatus.SENDING
    ) {
      const known = await deps.prisma.supportListMembership.findUnique({
        where: { id: membershipId },
        include: { channel: true },
      });
      await recordUnconfirmedDelivery(deps, telegram, {
        publicationId: publication.id,
        ownerTelegramId: bot.owner.telegramId,
        language: ownerLanguage,
        listName,
        channelLabel: known
          ? channelDisplayName(known.channel)
          : String(publication.channelTelegramId),
        alreadyNotified: publication.ownerNotified,
      });
      continue;
    }
    const membership = await deps.prisma.supportListMembership.findUnique({
      where: { id: membershipId },
      include: { channel: true },
    });
    if (!membership || !isPublishable(membership)) {
      await deps.prisma.supportListPublication.update({
        where: { id: publication.id },
        data: { status: SupportListPublicationStatus.SKIPPED },
      });
      continue;
    }
    const channelLabel = channelDisplayName(membership.channel);
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
    const claimedSend = await deps.prisma.supportListPublication.updateMany({
      where: {
        id: publication.id,
        status: SupportListPublicationStatus.PENDING,
        messageId: null,
      },
      data: {
        status: SupportListPublicationStatus.SENDING,
        sendAttemptedAt: new Date(),
        channelTelegramId: membership.channelTelegramId,
      },
    });
    if (claimedSend.count !== 1) {
      const fresh = await deps.prisma.supportListPublication.findUnique({
        where: { id: publication.id },
      });
      if (
        fresh &&
        !fresh.messageId &&
        (fresh.status === SupportListPublicationStatus.SENDING ||
          fresh.status === SupportListPublicationStatus.UNCONFIRMED)
      ) {
        await recordUnconfirmedDelivery(deps, telegram, {
          publicationId: publication.id,
          ownerTelegramId: bot.owner.telegramId,
          language: ownerLanguage,
          listName,
          channelLabel,
          alreadyNotified: fresh.ownerNotified,
        });
      }
      continue;
    }
    let messageId: number;
    try {
      const message = await telegram.api.sendMessage(
        Number(membership.channelTelegramId),
        rendered.text,
        {
          ...(rendered.parseMode ? { parse_mode: rendered.parseMode } : {}),
          ...(markup
            ? { reply_markup: markup }
            : { link_preview_options: { is_disabled: true } }),
        },
      );
      messageId = message.message_id;
    } catch (error) {
      const failure = classifySendFailure(error);
      if (failure === "retry") {
        await deps.prisma.supportListPublication.updateMany({
          where: {
            id: publication.id,
            status: SupportListPublicationStatus.SENDING,
            messageId: null,
          },
          data: {
            status: SupportListPublicationStatus.PENDING,
            sendAttemptedAt: null,
          },
        });
        throw error;
      }
      if (failure === "rejected") {
        await deps.prisma.supportListPublication.updateMany({
          where: {
            id: publication.id,
            status: SupportListPublicationStatus.SENDING,
            messageId: null,
          },
          data: { status: SupportListPublicationStatus.FAILED },
        });
        continue;
      }
      await recordUnconfirmedDelivery(deps, telegram, {
        publicationId: publication.id,
        ownerTelegramId: bot.owner.telegramId,
        language: ownerLanguage,
        listName,
        channelLabel,
        alreadyNotified: false,
      });
      continue;
    }
    const sentAt = new Date();
    const captured = capturedRetentionMinutes(cycle.scheduledAt, cycle.deleteAt);
    const deleteAt = deleteAtFromSuccessfulSend(
      sentAt,
      captured >= MIN_RETENTION_MINUTES && captured <= MAX_RETENTION_MINUTES
        ? captured
        : settings.retentionMinutes,
    );
    const saved = await persistSentPublication(deps.prisma, publication.id, {
      messageId: BigInt(messageId),
      deleteAt,
      channelTelegramId: membership.channelTelegramId,
    });
    if (!saved) {
      throw new Error(
        "Telegram accepted the list post before its message id was stored",
      );
    }
    await deps.enqueueDelete(publication.id, deleteAt);
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
