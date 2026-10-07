import {
  SupportListAcceptanceStatus,
  type Prisma,
  type PrismaClient,
  type SupportListMembership,
  type SupportListSettings,
} from "@prisma/client";
import type { Bot as TelegramBot } from "grammy";
import {
  checkBotChannelRights,
  inspectSupportChannel,
  resolveChannelOpenUrl,
  selectChannelUrl,
  type OpenUrlResult,
} from "./access.js";
import { PAGE_SIZE } from "./constants.js";
import { MAX_ACCEPTED_CHANNELS } from "./constants.js";
import {
  acceptanceDecision,
  claimAcceptedSlot,
  disableReasonCodes,
  type DisableFlags,
  type DisableReasonCode,
} from "./eligibility.js";

type Tx = Prisma.TransactionClient;

export async function ensureSettings(
  prisma: PrismaClient,
  botId: string,
): Promise<SupportListSettings> {
  return prisma.supportListSettings.upsert({
    where: { botId },
    create: { botId },
    update: {},
  });
}

async function lockSettings(tx: Tx, settingsId: string): Promise<void> {
  await tx.$executeRaw`SELECT "id" FROM "support_list_settings" WHERE "id" = ${settingsId} FOR UPDATE`;
}

async function acceptedCount(tx: Tx, botId: string): Promise<number> {
  return tx.supportListMembership.count({
    where: {
      botId,
      deletedAt: null,
      acceptanceStatus: SupportListAcceptanceStatus.ACCEPTED,
    },
  });
}

export type SubmitResult =
  | { kind: "duplicate" }
  | { kind: "pending"; membershipId: string; title: string }
  | { kind: "accepted"; membershipId: string; title: string }
  | { kind: "full" };

export async function submitSupportChannel(input: {
  prisma: PrismaClient;
  telegramBot: TelegramBot;
  botId: string;
  addedByUserId: string;
  chatReference: number | string;
  actorTelegramId: number;
}): Promise<SubmitResult> {
  const inspected = await inspectSupportChannel(
    input.telegramBot,
    input.chatReference,
    input.actorTelegramId,
  );
  const inviteUnavailable = !inspected.username && !inspected.botCanInvite;

  return input.prisma.$transaction(async (tx) => {
    const settings = await tx.supportListSettings.upsert({
      where: { botId: input.botId },
      create: { botId: input.botId },
      update: {},
    });
    await lockSettings(tx, settings.id);

    const existing = await tx.supportListMembership.findFirst({
      where: {
        botId: input.botId,
        channelTelegramId: BigInt(inspected.id),
        deletedAt: null,
        acceptanceStatus: { not: SupportListAcceptanceStatus.REJECTED },
      },
      select: { id: true },
    });
    if (existing) {
      return { kind: "duplicate" };
    }

    let channel = await tx.channel.findUnique({
      where: { channelTelegramId: BigInt(inspected.id) },
    });
    if (!channel) {
      channel = await tx.channel.create({
        data: {
          ownerId: input.addedByUserId,
          telegramOwnerId: inspected.telegramOwnerId,
          channelTelegramId: BigInt(inspected.id),
          title: inspected.title,
          username: inspected.username,
          memberCount: inspected.memberCount,
        },
      });
      await tx.wallet.upsert({
        where: { userId: input.addedByUserId },
        create: { userId: input.addedByUserId },
        update: {},
      });
    } else {
      channel = await tx.channel.update({
        where: { id: channel.id },
        data: {
          title: inspected.title,
          username: inspected.username,
          memberCount: inspected.memberCount,
          telegramOwnerId: inspected.telegramOwnerId,
        },
      });
    }

    const decision = acceptanceDecision({
      mode: settings.acceptanceMode,
      acceptedCount: await acceptedCount(tx, input.botId),
    });
    if (decision === "full") {
      return { kind: "full" };
    }

    const membership = await tx.supportListMembership.create({
      data: {
        settingsId: settings.id,
        botId: input.botId,
        channelId: channel.id,
        channelTelegramId: BigInt(inspected.id),
        addedByUserId: input.addedByUserId,
        acceptanceStatus:
          decision === "accept"
            ? SupportListAcceptanceStatus.ACCEPTED
            : SupportListAcceptanceStatus.PENDING,
        inviteUnavailable,
      },
    });
    return {
      kind: decision === "accept" ? "accepted" : "pending",
      membershipId: membership.id,
      title: inspected.title ?? inspected.username ?? String(inspected.id),
    };
  });
}

export async function acceptMembership(
  prisma: PrismaClient,
  botId: string,
  membershipId: string,
): Promise<"accepted" | "full" | "missing"> {
  return prisma.$transaction(async (tx) => {
    const settings = await tx.supportListSettings.findUnique({
      where: { botId },
    });
    if (!settings) {
      return "missing";
    }
    await lockSettings(tx, settings.id);
    const membership = await tx.supportListMembership.findFirst({
      where: {
        id: membershipId,
        botId,
        deletedAt: null,
        acceptanceStatus: SupportListAcceptanceStatus.PENDING,
      },
    });
    if (!membership) {
      return "missing";
    }
    if (!claimAcceptedSlot(await acceptedCount(tx, botId), MAX_ACCEPTED_CHANNELS)) {
      return "full";
    }
    await tx.supportListMembership.update({
      where: { id: membership.id },
      data: { acceptanceStatus: SupportListAcceptanceStatus.ACCEPTED },
    });
    return "accepted";
  });
}

export async function rejectMembership(
  prisma: PrismaClient,
  botId: string,
  membershipId: string,
): Promise<SupportListMembership | null> {
  const membership = await prisma.supportListMembership.findFirst({
    where: {
      id: membershipId,
      botId,
      deletedAt: null,
      acceptanceStatus: SupportListAcceptanceStatus.PENDING,
    },
  });
  if (!membership) {
    return null;
  }
  return prisma.supportListMembership.update({
    where: { id: membership.id },
    data: { acceptanceStatus: SupportListAcceptanceStatus.REJECTED },
  });
}

export async function softDeleteMembership(
  prisma: PrismaClient,
  botId: string,
  membershipId: string,
): Promise<SupportListMembership | null> {
  const membership = await prisma.supportListMembership.findFirst({
    where: { id: membershipId, botId, deletedAt: null },
  });
  if (!membership) {
    return null;
  }
  return prisma.supportListMembership.update({
    where: { id: membership.id },
    data: { deletedAt: new Date() },
  });
}

export async function disableByParticipant(
  prisma: PrismaClient,
  botId: string,
  membershipId: string,
  actorUserId: string,
): Promise<SupportListMembership | null> {
  const membership = await prisma.supportListMembership.findFirst({
    where: {
      id: membershipId,
      botId,
      addedByUserId: actorUserId,
      deletedAt: null,
      acceptanceStatus: SupportListAcceptanceStatus.ACCEPTED,
    },
  });
  if (!membership) {
    return null;
  }
  return prisma.supportListMembership.update({
    where: { id: membership.id },
    data: { participantDisabled: true },
  });
}

export async function disableByAdmin(
  prisma: PrismaClient,
  botId: string,
  membershipId: string,
  reason: string,
): Promise<SupportListMembership | null> {
  const membership = await prisma.supportListMembership.findFirst({
    where: {
      id: membershipId,
      botId,
      deletedAt: null,
      acceptanceStatus: SupportListAcceptanceStatus.ACCEPTED,
    },
  });
  if (!membership) {
    return null;
  }
  return prisma.supportListMembership.update({
    where: { id: membership.id },
    data: { adminDisabled: true, adminDisableReason: reason },
  });
}

export type ActivateResult =
  | { kind: "resumed" }
  | { kind: "still_blocked"; reasons: DisableReasonCode[] }
  | { kind: "permissions" }
  | { kind: "invite" }
  | { kind: "unavailable" }
  | { kind: "missing" }
  | { kind: "forbidden" };

function flagsOf(membership: SupportListMembership): DisableFlags {
  return {
    participantDisabled: membership.participantDisabled,
    adminDisabled: membership.adminDisabled,
    adminDisableReason: membership.adminDisableReason,
    permissionsLost: membership.permissionsLost,
    inviteUnavailable: membership.inviteUnavailable,
  };
}

export async function activateMembership(input: {
  prisma: PrismaClient;
  telegramBot: TelegramBot;
  botId: string;
  membershipId: string;
  actorUserId: string;
  asOwner: boolean;
}): Promise<ActivateResult> {
  const membership = await input.prisma.supportListMembership.findFirst({
    where: {
      id: input.membershipId,
      botId: input.botId,
      deletedAt: null,
      acceptanceStatus: SupportListAcceptanceStatus.ACCEPTED,
    },
  });
  if (!membership) {
    return { kind: "missing" };
  }
  if (
    !input.asOwner &&
    membership.addedByUserId !== input.actorUserId
  ) {
    return { kind: "forbidden" };
  }

  const rights = await checkBotChannelRights(
    input.telegramBot,
    Number(membership.channelTelegramId),
  );
  if (rights.kind === "unavailable") {
    return { kind: "unavailable" };
  }
  if (rights.kind === "lost") {
    await input.prisma.supportListMembership.update({
      where: { id: membership.id },
      data: { permissionsLost: true },
    });
    return { kind: "permissions" };
  }
  if (rights.isPrivate && !rights.hasInvite) {
    await input.prisma.supportListMembership.update({
      where: { id: membership.id },
      data: { inviteUnavailable: true, permissionsLost: false },
    });
    return { kind: "invite" };
  }

  const next: DisableFlags = {
    ...flagsOf(membership),
    permissionsLost: false,
    inviteUnavailable: false,
  };
  if (input.asOwner) {
    next.adminDisabled = false;
    next.adminDisableReason = null;
  } else {
    next.participantDisabled = false;
  }

  await input.prisma.supportListMembership.update({
    where: { id: membership.id },
    data: {
      participantDisabled: next.participantDisabled,
      adminDisabled: next.adminDisabled,
      adminDisableReason: next.adminDisableReason,
      permissionsLost: false,
      inviteUnavailable: false,
    },
  });
  const reasons = disableReasonCodes(next);
  return reasons.length === 0
    ? { kind: "resumed" }
    : { kind: "still_blocked", reasons };
}

export async function persistChannelOpen(
  prisma: PrismaClient,
  membership: {
    id: string;
    inviteUnavailable: boolean;
    username: string | null;
  },
  opened: OpenUrlResult,
): Promise<void> {
  if (opened.kind === "unavailable") {
    return;
  }
  if (opened.kind === "url" && opened.created) {
    await prisma.supportListMembership.update({
      where: { id: membership.id },
      data: { inviteUrl: opened.url },
    });
    return;
  }
  if (
    opened.kind === "url" &&
    membership.username &&
    membership.inviteUnavailable
  ) {
    await prisma.supportListMembership.update({
      where: { id: membership.id },
      data: { inviteUnavailable: false },
    });
    return;
  }
  if (opened.kind === "invite_disabled") {
    await prisma.supportListMembership.update({
      where: { id: membership.id },
      data: { inviteUnavailable: true },
    });
    return;
  }
  if (opened.kind === "permissions_lost") {
    await prisma.supportListMembership.update({
      where: { id: membership.id },
      data: { permissionsLost: true },
    });
  }
}

export async function openMembership(input: {
  prisma: PrismaClient;
  telegramBot: TelegramBot;
  botId: string;
  membershipId: string;
}): Promise<
  | { kind: "url"; url: string; title: string }
  | { kind: "invite_disabled" }
  | { kind: "permissions_lost" }
  | { kind: "unavailable" }
  | { kind: "missing" }
> {
  const membership = await input.prisma.supportListMembership.findFirst({
    where: { id: input.membershipId, botId: input.botId, deletedAt: null },
    include: { channel: true },
  });
  if (!membership) {
    return { kind: "missing" };
  }
  if (
    membership.inviteUnavailable &&
    selectChannelUrl({
      username: membership.channel.username,
      storedInviteUrl: membership.inviteUrl,
    }).kind === "create"
  ) {
    return { kind: "invite_disabled" };
  }
  const opened: OpenUrlResult = await resolveChannelOpenUrl(
    input.telegramBot,
    {
      channelTelegramId: membership.channelTelegramId,
      username: membership.channel.username,
      storedInviteUrl: membership.inviteUrl,
    },
  );
  await persistChannelOpen(
    input.prisma,
    {
      id: membership.id,
      inviteUnavailable: membership.inviteUnavailable,
      username: membership.channel.username,
    },
    opened,
  );
  if (opened.kind !== "url") {
    return { kind: opened.kind };
  }
  return {
    kind: "url",
    url: opened.url,
    title: membership.channel.title ?? membership.channel.username ?? "channel",
  };
}

export type RightsNotice = {
  addedByUserId: string;
  telegramId: number;
  event:
    | "permissions_lost"
    | "permissions_restored"
    | "invite_lost"
    | "invite_restored";
};

export async function syncSupportListRights(input: {
  prisma: PrismaClient;
  botId: string;
  channelTelegramId: number;
  valid: boolean;
  isPrivate: boolean;
  hasInvite: boolean;
}): Promise<RightsNotice[]> {
  const memberships = await input.prisma.supportListMembership.findMany({
    where: {
      botId: input.botId,
      channelTelegramId: BigInt(input.channelTelegramId),
      deletedAt: null,
      acceptanceStatus: { not: SupportListAcceptanceStatus.REJECTED },
    },
    include: { addedBy: { select: { telegramId: true } } },
  });
  const notices: RightsNotice[] = [];
  for (const membership of memberships) {
    const data: Prisma.SupportListMembershipUpdateInput = {};
    const telegramId = Number(membership.addedBy.telegramId);
    if (!input.valid && !membership.permissionsLost) {
      data.permissionsLost = true;
      notices.push({
        addedByUserId: membership.addedByUserId,
        telegramId,
        event: "permissions_lost",
      });
    }
    if (input.valid && membership.permissionsLost) {
      data.permissionsLost = false;
      notices.push({
        addedByUserId: membership.addedByUserId,
        telegramId,
        event: "permissions_restored",
      });
    }
    const inviteBlocked = input.isPrivate && !input.hasInvite;
    if (input.valid && inviteBlocked && !membership.inviteUnavailable) {
      data.inviteUnavailable = true;
      notices.push({
        addedByUserId: membership.addedByUserId,
        telegramId,
        event: "invite_lost",
      });
    }
    if (input.valid && !inviteBlocked && membership.inviteUnavailable) {
      data.inviteUnavailable = false;
      notices.push({
        addedByUserId: membership.addedByUserId,
        telegramId,
        event: "invite_restored",
      });
    }
    if (Object.keys(data).length > 0) {
      await input.prisma.supportListMembership.update({
        where: { id: membership.id },
        data,
      });
    }
  }
  return notices;
}

export interface MembershipPageItem {
  id: string;
  title: string;
  acceptanceStatus: SupportListAcceptanceStatus;
  flags: DisableFlags;
}

export async function pageMemberships(input: {
  prisma: PrismaClient;
  botId: string;
  page: number;
  addedByUserId?: string;
  acceptanceStatus?: SupportListAcceptanceStatus;
}): Promise<{
  items: MembershipPageItem[];
  page: number;
  pages: number;
}> {
  const where: Prisma.SupportListMembershipWhereInput = {
    botId: input.botId,
    deletedAt: null,
    acceptanceStatus:
      input.acceptanceStatus ?? {
        not: SupportListAcceptanceStatus.REJECTED,
      },
    ...(input.addedByUserId
      ? { addedByUserId: input.addedByUserId }
      : {}),
  };
  const total = await input.prisma.supportListMembership.count({ where });
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const page = Math.min(Math.max(input.page, 0), pages - 1);
  const rows = await input.prisma.supportListMembership.findMany({
    where,
    include: { channel: { select: { title: true, username: true } } },
    orderBy: { createdAt: "asc" },
    skip: page * PAGE_SIZE,
    take: PAGE_SIZE,
  });
  return {
    page,
    pages,
    items: rows.map((row) => ({
      id: row.id,
      title: row.channel.title ?? row.channel.username ?? row.id,
      acceptanceStatus: row.acceptanceStatus,
      flags: flagsOf(row),
    })),
  };
}

export async function getMembershipForBot(
  prisma: PrismaClient,
  botId: string,
  membershipId: string,
) {
  return prisma.supportListMembership.findFirst({
    where: { id: membershipId, botId, deletedAt: null },
    include: {
      channel: true,
      addedBy: { select: { id: true, telegramId: true } },
    },
  });
}
