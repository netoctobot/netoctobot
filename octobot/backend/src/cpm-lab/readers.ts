import { Api, helpers } from "teleproto";
import type { LabChannelConfig } from "./config.js";
import { LabIntegrityError } from "./errors.js";
import { LAB_LIMITS } from "./policy.js";
import type { ResultKind } from "./store.js";
import type { LabReader } from "./types.js";

export type LabCallOptions = {
  maxRetryCount: 0;
  floodSleepThreshold: 0;
  timeout: number;
  abortSignal: AbortSignal;
};

/** Per call, teleproto 1.230.1 neither retries nor sleeps on FLOOD_WAIT with these options. */
export function labCallOptions(signal: AbortSignal): LabCallOptions {
  return {
    maxRetryCount: 0,
    floodSleepThreshold: 0,
    timeout: LAB_LIMITS.perCallTimeoutMs,
    abortSignal: signal,
  };
}

export type LabRpc = {
  invokeLab(request: Api.AnyRequest, options: LabCallOptions): Promise<unknown>;
};

export type ParsedObservation = {
  messageId: number;
  views: number | null;
  resultKind: ResultKind;
};

export interface ReaderTransport {
  readonly reader: LabReader;
  readonly resolveMethod: string;
  readonly readMethod: string;
  resolve(signal: AbortSignal): Promise<void>;
  read(messageIds: number[], signal: AbortSignal): Promise<ParsedObservation[]>;
}

export class LabPeerError extends Error {
  constructor(readonly errorMessage: "CHANNEL_PRIVATE" | "PEER_ID_INVALID", detail: string) {
    super(`${errorMessage}: ${detail}`);
    this.name = "LabPeerError";
  }
}

type Shape = { className?: string } & Record<string, unknown>;

export class BotChannelReader implements ReaderTransport {
  readonly reader = "BOT_CHANNELS_GET_MESSAGES" as const;
  readonly resolveMethod = "channels.GetChannels";
  readonly readMethod = "channels.GetMessages";
  private accessHash: string | null = null;

  constructor(
    private readonly rpc: LabRpc,
    private readonly channel: LabChannelConfig,
  ) {}

  async resolve(signal: AbortSignal): Promise<void> {
    const response = (await this.rpc.invokeLab(
      new Api.channels.GetChannels({
        id: [
          new Api.InputChannel({
            channelId: helpers.returnBigInt(this.channel.telegramChannelId.toString()),
            accessHash: helpers.returnBigInt(0),
          }),
        ],
      }),
      labCallOptions(signal),
    )) as Shape;
    const chat = findChannel(asArray(response.chats), this.channel.telegramChannelId);
    this.accessHash = accessHashOf(chat) ?? "0";
  }

  async read(messageIds: number[], signal: AbortSignal): Promise<ParsedObservation[]> {
    if (this.accessHash === null) {
      throw new LabIntegrityError("bot reader used before channel resolution");
    }
    const response = await this.rpc.invokeLab(
      new Api.channels.GetMessages({
        channel: new Api.InputChannel({
          channelId: helpers.returnBigInt(this.channel.telegramChannelId.toString()),
          accessHash: helpers.returnBigInt(this.accessHash),
        }),
        id: messageIds.map((id) => new Api.InputMessageID({ id })),
      }),
      labCallOptions(signal),
    );
    return parseBotMessages(response, this.channel.telegramChannelId, messageIds);
  }
}

/** The access hash comes from this user's own session and is never shared with the bot reader. */
export class UserViewsReader implements ReaderTransport {
  readonly reader = "USER_GET_MESSAGES_VIEWS" as const;
  readonly resolveMethod: string;
  readonly readMethod = "messages.GetMessagesViews";
  private accessHash: string | null = null;

  constructor(
    private readonly rpc: LabRpc,
    private readonly channel: LabChannelConfig,
  ) {
    if (channel.username === null && channel.inviteHash === null) {
      throw new LabPeerError(
        "PEER_ID_INVALID",
        "set LAB_CHANNEL_USERNAME or LAB_CHANNEL_INVITE_LINK so the user session can resolve the channel",
      );
    }
    this.resolveMethod =
      channel.username !== null ? "contacts.ResolveUsername" : "messages.CheckChatInvite";
  }

  async resolve(signal: AbortSignal): Promise<void> {
    if (this.channel.username !== null) {
      const response = (await this.rpc.invokeLab(
        new Api.contacts.ResolveUsername({ username: this.channel.username }),
        labCallOptions(signal),
      )) as Shape;
      const peer = response.peer as Shape | undefined;
      if (peer?.className !== "PeerChannel" || String(peer.channelId) !== this.channel.telegramChannelId.toString()) {
        throw new LabIntegrityError("the username resolved to a different peer than LAB_CHANNEL_ID");
      }
      this.accessHash = requireAccessHash(findChannel(asArray(response.chats), this.channel.telegramChannelId));
      return;
    }
    const response = (await this.rpc.invokeLab(
      new Api.messages.CheckChatInvite({ hash: this.channel.inviteHash ?? "" }),
      labCallOptions(signal),
    )) as Shape;
    if (response.className !== "ChatInviteAlready") {
      throw new LabPeerError(
        "CHANNEL_PRIVATE",
        "the user account is not a member of the test channel. The lab does not join channels",
      );
    }
    this.accessHash = requireAccessHash(
      findChannel([response.chat as Shape], this.channel.telegramChannelId),
    );
  }

  async read(messageIds: number[], signal: AbortSignal): Promise<ParsedObservation[]> {
    if (this.accessHash === null) {
      throw new LabIntegrityError("user reader used before channel resolution");
    }
    const response = await this.rpc.invokeLab(
      new Api.messages.GetMessagesViews({
        peer: new Api.InputPeerChannel({
          channelId: helpers.returnBigInt(this.channel.telegramChannelId.toString()),
          accessHash: helpers.returnBigInt(this.accessHash),
        }),
        id: messageIds,
        increment: false,
      }),
      labCallOptions(signal),
    );
    return parseUserViews(response, messageIds);
  }
}

/**
 * Every requested id must appear exactly once, from the configured channel.
 * MessageEmpty is MESSAGE_EMPTY. A message without views is VIEWS_ABSENT.
 */
export function parseBotMessages(
  response: unknown,
  channelId: bigint,
  messageIds: readonly number[],
): ParsedObservation[] {
  const shape = response as Shape;
  if (!shape || !["messages.ChannelMessages", "messages.Messages", "messages.MessagesSlice"].includes(String(shape.className))) {
    throw new LabIntegrityError("unexpected response type for channels.getMessages");
  }
  const messages = asArray(shape.messages);
  if (messages.length !== messageIds.length) {
    throw new LabIntegrityError("message count differs from the requested ids");
  }
  const byId = new Map<number, Shape>();
  for (const message of messages) {
    const id = Number(message.id);
    if (byId.has(id)) {
      throw new LabIntegrityError("a message id appears twice in the response");
    }
    byId.set(id, message);
  }
  return messageIds.map((messageId) => {
    const message = byId.get(messageId);
    if (!message) {
      throw new LabIntegrityError("a requested message id is missing from the response");
    }
    const peer = message.peerId as Shape | undefined;
    if (message.className === "MessageEmpty") {
      if (peer !== undefined && !samePeerChannel(peer, channelId)) {
        throw new LabIntegrityError("an empty message names another channel");
      }
      return { messageId, views: null, resultKind: "MESSAGE_EMPTY" };
    }
    if (!peer || !samePeerChannel(peer, channelId)) {
      throw new LabIntegrityError("a message belongs to another peer than LAB_CHANNEL_ID");
    }
    const views = message.views;
    if (typeof views !== "number") {
      return { messageId, views: null, resultKind: "VIEWS_ABSENT" };
    }
    return { messageId, views, resultKind: "MESSAGE" };
  });
}

/** The response carries no ids. Order is assumed to follow the request, and only the length is checked. */
export function parseUserViews(
  response: unknown,
  messageIds: readonly number[],
): ParsedObservation[] {
  const shape = response as Shape;
  if (!shape || shape.className !== "messages.MessageViews") {
    throw new LabIntegrityError("unexpected response type for messages.getMessagesViews");
  }
  const views = asArray(shape.views);
  if (views.length !== messageIds.length) {
    throw new LabIntegrityError("views count differs from the requested ids");
  }
  return messageIds.map((messageId, index) => {
    const value = views[index]?.views;
    return typeof value === "number"
      ? { messageId, views: value, resultKind: "MESSAGE" as const }
      : { messageId, views: null, resultKind: "VIEWS_ABSENT" as const };
  });
}

function findChannel(chats: Shape[], channelId: bigint): Shape {
  const chat = chats.find((candidate) => String(candidate?.id) === channelId.toString());
  if (!chat) {
    throw new LabIntegrityError("the resolved chats do not include LAB_CHANNEL_ID");
  }
  if (chat.className === "ChannelForbidden") {
    throw new LabPeerError("CHANNEL_PRIVATE", "the session has no access to the test channel");
  }
  if (chat.className !== "Channel") {
    throw new LabIntegrityError("LAB_CHANNEL_ID is not a channel");
  }
  return chat;
}

function accessHashOf(chat: Shape): string | null {
  const hash = chat.accessHash;
  return hash === undefined || hash === null ? null : String(hash);
}

function requireAccessHash(chat: Shape): string {
  const hash = accessHashOf(chat);
  if (hash === null || chat.min === true) {
    throw new LabIntegrityError("the user session did not return a full access hash for the channel");
  }
  return hash;
}

function samePeerChannel(peer: Shape, channelId: bigint): boolean {
  return peer.className === "PeerChannel" && String(peer.channelId) === channelId.toString();
}

function asArray(value: unknown): Shape[] {
  return Array.isArray(value) ? (value as Shape[]) : [];
}
