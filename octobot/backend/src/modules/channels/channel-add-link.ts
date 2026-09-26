const SUGGESTED_CHANNEL_RIGHTS = [
  "post_messages",
  "edit_messages",
  "delete_messages",
  "invite_users",
] as const;

export function buildChannelAddLink(botUsername: string): string {
  const normalized = botUsername.replace(/^@/, "");
  if (!/^[A-Za-z0-9_]{5,}$/.test(normalized)) {
    throw new Error("Invalid Telegram bot username");
  }

  return `https://t.me/${normalized}?startchannel&admin=${SUGGESTED_CHANNEL_RIGHTS.join("+")}`;
}
