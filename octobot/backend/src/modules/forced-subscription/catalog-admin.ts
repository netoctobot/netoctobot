import { Api } from "grammy";
import type { PrismaClient } from "@prisma/client";
import { resolveChannelChatReference } from "../channels/channel-reference.js";
import {
  classifyMembershipError,
  isChannelAdministrator,
  publicJoinUrl,
} from "./membership.js";

export interface CatalogChat {
  id: number;
  type: string;
  title?: string;
  username?: string;
}

export interface CatalogMember {
  status: string;
  is_member?: boolean;
  can_invite_users?: boolean;
}

export interface CatalogAdministrator {
  status: string;
  user: { id: number };
}

export interface CatalogTelegram {
  getMe(): Promise<{ id: number }>;
  getChat(chatId: number | string): Promise<CatalogChat>;
  getChatMember(chatId: number, userId: number): Promise<CatalogMember>;
  getChatAdministrators(chatId: number): Promise<CatalogAdministrator[]>;
  createChatInviteLink(chatId: number): Promise<{ invite_link: string }>;
  exportChatInviteLink(chatId: number): Promise<string>;
}

export type CatalogMutationError =
  | "catalog_unresolved"
  | "catalog_not_channel"
  | "catalog_unavailable"
  | "catalog_not_admin"
  | "catalog_join_unavailable"
  | "not_found";

export function catalogTelegramFromToken(token: string): CatalogTelegram {
  const api = new Api(token);
  return {
    getMe: () => api.getMe(),
    async getChat(chatId) {
      const chat = await api.getChat(chatId);
      return {
        id: chat.id,
        type: chat.type,
        title: "title" in chat ? chat.title : undefined,
        username: "username" in chat ? chat.username : undefined,
      };
    },
    getChatMember: (chatId, userId) => api.getChatMember(chatId, userId),
    async getChatAdministrators(chatId) {
      const members = await api.getChatAdministrators(chatId);
      return members.flatMap((member) =>
        "user" in member ? [{ status: member.status, user: { id: member.user.id } }] : [],
      );
    },
    createChatInviteLink: (chatId) => api.createChatInviteLink(chatId),
    exportChatInviteLink: (chatId) => api.exportChatInviteLink(chatId),
  };
}

export function parseCatalogReference(value: string): number | string | null {
  return resolveChannelChatReference({ text: value.trim() });
}

async function callTelegram<T>(
  action: () => Promise<T>,
): Promise<{ ok: true; value: T } | { ok: false; error: CatalogMutationError }> {
  try {
    return { ok: true, value: await action() };
  } catch (error) {
    const kind = classifyMembershipError(error);
    if (kind === "absent") {
      return { ok: false, error: "catalog_unresolved" };
    }
    return { ok: false, error: "catalog_unavailable" };
  }
}

export async function addCatalogChannel(
  prisma: PrismaClient,
  telegram: CatalogTelegram,
  adminUsername: string,
  reference: string,
  ip: string | undefined,
): Promise<{ ok: true; id: string } | { ok: false; error: CatalogMutationError }> {
  const parsed = parseCatalogReference(reference);
  if (parsed === null) {
    return { ok: false, error: "catalog_unresolved" };
  }
  const chatResult = await callTelegram(() => telegram.getChat(parsed));
  if (!chatResult.ok) {
    return chatResult;
  }
  const chat = chatResult.value;
  if (chat.type !== "channel") {
    return { ok: false, error: "catalog_not_channel" };
  }
  const telegramId = BigInt(chat.id);
  const existing = await prisma.channel.findUnique({
    where: { channelTelegramId: telegramId },
    select: {
      id: true,
      ownerId: true,
      telegramOwnerId: true,
      platformForcedCatalog: { select: { id: true } },
    },
  });

  let channelId = existing?.id;
  if (existing) {
    await prisma.channel.update({
      where: { id: existing.id },
      data: {
        isPlatformCatalog: true,
        title: chat.title ?? undefined,
        username: chat.username ?? undefined,
      },
    });
  } else {
    const admins = await callTelegram(() => telegram.getChatAdministrators(chat.id));
    const creator = admins.ok
      ? admins.value.find((member) => member.status === "creator")
      : undefined;
    const creatorId = creator ? BigInt(creator.user.id) : null;
    const owner = creatorId
      ? await prisma.user.findUnique({
          where: { telegramId: creatorId },
          select: { id: true },
        })
      : null;
    const created = await prisma.channel.create({
      data: {
        ownerId: owner?.id,
        telegramOwnerId: creatorId,
        channelTelegramId: telegramId,
        title: chat.title,
        username: chat.username,
        isPlatformCatalog: true,
      },
      select: { id: true },
    });
    channelId = created.id;
  }

  if (!channelId) {
    return { ok: false, error: "catalog_unavailable" };
  }
  const catalog =
    existing?.platformForcedCatalog ??
    (await prisma.platformForcedChannel.create({
      data: {
        channelId,
        isActive: false,
        addedByAdminUsername: adminUsername,
        sortOrder: await prisma.platformForcedChannel.count(),
      },
      select: { id: true },
    }));
  await prisma.auditLog.create({
    data: {
      action: "catalog.add",
      entityType: "PlatformForcedChannel",
      entityId: catalog.id,
      details: { adminUsername, channelId },
      ip,
    },
  });
  return { ok: true, id: catalog.id };
}

export async function removeCatalogChannel(
  prisma: PrismaClient,
  adminUsername: string,
  id: string,
  ip: string | undefined,
): Promise<boolean> {
  const row = await prisma.platformForcedChannel.findUnique({
    where: { id },
    select: { id: true, channelId: true },
  });
  if (!row) {
    return false;
  }
  await prisma.platformForcedChannel.delete({ where: { id } });
  await prisma.channel.update({
    where: { id: row.channelId },
    data: { isPlatformCatalog: false },
  });
  await prisma.auditLog.create({
    data: {
      action: "catalog.remove",
      entityType: "PlatformForcedChannel",
      entityId: id,
      details: { adminUsername, channelId: row.channelId },
      ip,
    },
  });
  return true;
}

async function resolveJoinUrl(
  telegram: CatalogTelegram,
  chat: CatalogChat,
): Promise<string | null> {
  const published = publicJoinUrl(chat.username);
  if (published) {
    return published;
  }
  try {
    const created = await telegram.createChatInviteLink(chat.id);
    if (created.invite_link) {
      return created.invite_link;
    }
  } catch {
    // A private channel still needs one usable invite link.
  }
  try {
    return (await telegram.exportChatInviteLink(chat.id)) || null;
  } catch {
    return null;
  }
}

export async function activateCatalogChannel(
  prisma: PrismaClient,
  telegram: CatalogTelegram,
  adminUsername: string,
  id: string,
  ip: string | undefined,
): Promise<{ ok: true; id: string; isActive: true } | { ok: false; error: CatalogMutationError }> {
  const row = await prisma.platformForcedChannel.findUnique({
    where: { id },
    select: {
      id: true,
      channel: {
        select: { channelTelegramId: true, username: true, title: true },
      },
    },
  });
  if (!row) {
    return { ok: false, error: "not_found" };
  }
  const me = await callTelegram(() => telegram.getMe());
  if (!me.ok) {
    return me;
  }
  const chatId = Number(row.channel.channelTelegramId);
  const member = await callTelegram(() => telegram.getChatMember(chatId, me.value.id));
  if (!member.ok) {
    return member.error === "catalog_unresolved"
      ? { ok: false, error: "catalog_not_admin" }
      : member;
  }
  if (!isChannelAdministrator(member.value.status)) {
    return { ok: false, error: "catalog_not_admin" };
  }
  const chatResult = await callTelegram(() => telegram.getChat(chatId));
  if (!chatResult.ok) {
    return chatResult;
  }
  const joinUrl = await resolveJoinUrl(telegram, chatResult.value);
  if (!joinUrl) {
    return { ok: false, error: "catalog_join_unavailable" };
  }
  const updated = await prisma.platformForcedChannel.update({
    where: { id },
    data: { isActive: true, joinUrl },
    select: { id: true, isActive: true },
  });
  await prisma.auditLog.create({
    data: {
      action: "catalog.set_active",
      entityType: "PlatformForcedChannel",
      entityId: id,
      details: { isActive: true, adminUsername },
      ip,
    },
  });
  return { ok: true, id: updated.id, isActive: true };
}
