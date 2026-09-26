import type { Message } from "grammy/types";

const USERNAME_PATTERN = "[A-Za-z0-9_]{5,32}";
const PLAIN_USERNAME = new RegExp(`^@?(${USERNAME_PATTERN})$`);
const TME_USERNAME = new RegExp(
  `^(?:https?://)?(?:www\\.)?t\\.me/(${USERNAME_PATTERN})/?$`,
  "i",
);
const NUMERIC_CHANNEL_ID = /^-100\d{6,13}$/;

export type ChannelReferenceMessage = Pick<
  Message,
  "forward_origin" | "text"
>;

export function resolveChannelChatReference(
  message: ChannelReferenceMessage,
): number | string | null {
  if (message.forward_origin) {
    return message.forward_origin.type === "channel" &&
      message.forward_origin.chat.type === "channel"
      ? message.forward_origin.chat.id
      : null;
  }

  const text = message.text?.trim();
  if (!text || text.includes("\n")) {
    return null;
  }

  if (NUMERIC_CHANNEL_ID.test(text)) {
    const channelId = Number(text);
    return Number.isSafeInteger(channelId) ? channelId : null;
  }

  const usernameMatch =
    PLAIN_USERNAME.exec(text) ?? TME_USERNAME.exec(text);
  return usernameMatch ? `@${usernameMatch[1]}` : null;
}
