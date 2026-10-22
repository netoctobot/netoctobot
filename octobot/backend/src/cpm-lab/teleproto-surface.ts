import { Logger, LogLevel } from "teleproto/extensions/Logger.js";
import { Api } from "teleproto";
import { redactSecrets } from "./redact.js";

/**
 * Verified against the installed teleproto 1.230.1 type declarations:
 * Api.channels.GetMessages is channels.getMessages#ad8c9a23 (2911672867) and has
 * channel + id only. Api.messages.GetMessagesViews is messages.getMessagesViews#5784d3e1
 * (1468322785) and takes increment. The lab passes false explicitly.
 */
export const verifiedTeleproto = {
  packageName: "teleproto",
  version: "1.230.1",
  license: "MIT",
  channelsGetMessages: "Api.channels.GetMessages",
  channelsGetMessagesConstructorId: 2_911_672_867,
  messagesGetMessagesViews: "Api.messages.GetMessagesViews",
  messagesGetMessagesViewsConstructorId: 1_468_322_785,
} as const;

export function buildChannelsGetMessages(channel: string, messageIds: number[]) {
  return new Api.channels.GetMessages({
    channel,
    id: messageIds.map((id) => new Api.InputMessageID({ id })),
  });
}

export function buildUserViewsRequest(peer: string, messageIds: number[]) {
  return new Api.messages.GetMessagesViews({
    peer,
    id: messageIds,
    increment: false,
  });
}

export class RedactingLabLogger extends Logger {
  constructor(
    private readonly secrets: readonly string[],
    private readonly sink: (line: string) => void,
  ) {
    super(LogLevel.DEBUG);
  }

  override log(level: LogLevel, message: string, error?: unknown): void {
    const combined =
      error === undefined ? message : `${message} ${redactableError(error)}`;
    this.sink(redactSecrets(`[${level}] ${combined}`, this.secrets));
  }
}

function redactableError(error: unknown): string {
  if (error instanceof Error) {
    return `${error.name}: ${error.message}\n${error.stack ?? ""}`;
  }
  return String(error);
}
