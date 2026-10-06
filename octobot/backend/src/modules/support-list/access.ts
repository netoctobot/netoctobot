import { GrammyError, HttpError, type Bot as TelegramBot } from "grammy";
import type { ChatMember } from "grammy/types";
import {
  BotAdminRequiredError,
  BotPermissionsRequiredError,
  ChannelAdministratorRequiredError,
  ChannelNotFoundError,
  hasRequiredChannelRights,
} from "../channels/channel.service.js";
import { isHttpsUrl } from "./render.js";

export class PromoterRequiredError extends Error {
  constructor() {
    super("The user cannot add channel administrators");
    this.name = "PromoterRequiredError";
  }
}

export class TelegramUnavailableError extends Error {
  constructor() {
    super("Telegram is temporarily unavailable");
    this.name = "TelegramUnavailableError";
  }
}

export function userCanPromote(member: ChatMember): boolean {
  if (member.status === "creator") {
    return true;
  }
  return (
    member.status === "administrator" &&
    member.can_promote_members === true
  );
}

export function botCanInvite(member: ChatMember): boolean {
  if (member.status === "creator") {
    return true;
  }
  return (
    member.status === "administrator" &&
    member.can_invite_users === true
  );
}

export function retryAfterMs(error: unknown): number | null {
  if (!(error instanceof GrammyError) || error.error_code !== 429) {
    return null;
  }
  const seconds = error.parameters?.retry_after ?? 5;
  return (seconds + 1) * 1000;
}

function rethrowTransient(error: unknown, clientError: Error): never {
  if (
    !(error instanceof GrammyError) ||
    error.error_code === 429 ||
    error.error_code >= 500
  ) {
    throw new TelegramUnavailableError();
  }
  throw clientError;
}

export interface InspectedChannel {
  id: number;
  title: string | null;
  username: string | null;
  memberCount: number;
  telegramOwnerId: bigint;
  botCanInvite: boolean;
}

export async function inspectSupportChannel(
  telegramBot: TelegramBot,
  chatReference: number | string,
  actorTelegramId: number,
): Promise<InspectedChannel> {
  let chat;
  try {
    chat = await telegramBot.api.getChat(chatReference);
  } catch (error) {
    rethrowTransient(error, new ChannelNotFoundError());
  }
  if (chat.type !== "channel") {
    throw new ChannelNotFoundError();
  }

  let botMembership: ChatMember;
  try {
    botMembership = await telegramBot.api.getChatMember(
      chat.id,
      telegramBot.botInfo.id,
    );
  } catch (error) {
    rethrowTransient(error, new BotAdminRequiredError());
  }
  if (
    botMembership.status !== "administrator" &&
    botMembership.status !== "creator"
  ) {
    throw new BotAdminRequiredError();
  }
  if (!hasRequiredChannelRights(botMembership)) {
    throw new BotPermissionsRequiredError();
  }

  let actorMembership: ChatMember;
  try {
    actorMembership = await telegramBot.api.getChatMember(
      chat.id,
      actorTelegramId,
    );
  } catch (error) {
    rethrowTransient(error, new ChannelAdministratorRequiredError());
  }
  if (
    actorMembership.status !== "creator" &&
    actorMembership.status !== "administrator"
  ) {
    throw new ChannelAdministratorRequiredError();
  }
  if (!userCanPromote(actorMembership)) {
    throw new PromoterRequiredError();
  }

  let administrators;
  try {
    administrators = await telegramBot.api.getChatAdministrators(chat.id);
  } catch (error) {
    rethrowTransient(error, new ChannelNotFoundError());
  }
  const creator = administrators.find(
    (administrator) => administrator.status === "creator",
  );
  if (!creator) {
    throw new ChannelNotFoundError();
  }

  const memberCount = await telegramBot.api
    .getChatMemberCount(chat.id)
    .catch(() => 0);

  return {
    id: chat.id,
    title: chat.title ?? null,
    username: chat.username ?? null,
    memberCount,
    telegramOwnerId: BigInt(creator.user.id),
    botCanInvite: botCanInvite(botMembership),
  };
}

export type OpenUrlResult =
  | { kind: "url"; url: string; created: boolean }
  | { kind: "invite_disabled" }
  | { kind: "permissions_lost" }
  | { kind: "unavailable" };

export function selectChannelUrl(input: {
  username: string | null;
  storedInviteUrl?: string | null;
}): { kind: "public" | "reuse"; url: string } | { kind: "create" } {
  const username = input.username?.trim();
  if (username) {
    return { kind: "public", url: `https://t.me/${username}` };
  }
  const stored = input.storedInviteUrl?.trim() ?? "";
  if (isHttpsUrl(stored)) {
    return { kind: "reuse", url: stored };
  }
  return { kind: "create" };
}

export function classifyInviteFailure(
  error: unknown,
): "unavailable" | "invite" | "permissions" {
  if (error instanceof HttpError || !(error instanceof GrammyError)) {
    return "unavailable";
  }
  if (error.error_code === 429 || error.error_code >= 500) {
    return "unavailable";
  }
  if (error.description.toLowerCase().includes("invite")) {
    return "invite";
  }
  return "permissions";
}

export async function resolveChannelOpenUrl(
  telegramBot: TelegramBot,
  input: {
    channelTelegramId: bigint | number;
    username: string | null;
    storedInviteUrl?: string | null;
  },
): Promise<OpenUrlResult> {
  const selected = selectChannelUrl(input);
  if (selected.kind !== "create") {
    return { kind: "url", url: selected.url, created: false };
  }
  try {
    const invite = await telegramBot.api.createChatInviteLink(
      Number(input.channelTelegramId),
      { name: "Octobot support list" },
    );
    return { kind: "url", url: invite.invite_link, created: true };
  } catch (error) {
    const failure = classifyInviteFailure(error);
    if (failure === "unavailable") {
      return { kind: "unavailable" };
    }
    if (failure === "invite") {
      return { kind: "invite_disabled" };
    }
    return { kind: "permissions_lost" };
  }
}

export type RightsCheck =
  | { kind: "ok"; isPrivate: boolean; hasInvite: boolean }
  | { kind: "lost" }
  | { kind: "unavailable" };

export async function checkBotChannelRights(
  telegramBot: TelegramBot,
  channelTelegramId: number,
): Promise<RightsCheck> {
  try {
    const chat = await telegramBot.api.getChat(channelTelegramId);
    if (chat.type !== "channel") {
      return { kind: "lost" };
    }
    const membership = await telegramBot.api.getChatMember(
      chat.id,
      telegramBot.botInfo.id,
    );
    if (!hasRequiredChannelRights(membership)) {
      return { kind: "lost" };
    }
    return {
      kind: "ok",
      isPrivate: !chat.username,
      hasInvite: botCanInvite(membership),
    };
  } catch (error) {
    if (
      error instanceof GrammyError &&
      error.error_code < 500 &&
      error.error_code !== 429
    ) {
      return { kind: "lost" };
    }
    return { kind: "unavailable" };
  }
}
