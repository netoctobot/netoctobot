export const labErrorClasses = [
  "FLOOD_WAIT",
  "AUTH_KEY_DUPLICATED",
  "SESSION_REVOKED",
  "USER_DEACTIVATED",
  "CHANNEL_PRIVATE",
  "MSG_ID_INVALID",
  "CHANNEL_INVALID",
  "TIMEOUT",
  "NETWORK",
  "UNKNOWN",
] as const;

export type LabErrorClass = (typeof labErrorClasses)[number];

export type ClassifiedLabError = {
  errorClass: LabErrorClass;
  floodWaitSeconds: number | null;
  punitiveBan: false;
  description: string;
};

const CLASS_DESCRIPTIONS: Record<LabErrorClass, string> = {
  FLOOD_WAIT: "Telegram asked the caller to wait before the next request.",
  AUTH_KEY_DUPLICATED: "The lab authorization session is in use elsewhere.",
  SESSION_REVOKED: "The lab session was revoked and needs a manual login.",
  USER_DEACTIVATED: "The account is deleted or deactivated. The cause is unknown.",
  CHANNEL_PRIVATE: "The caller has no access to the channel.",
  MSG_ID_INVALID: "The message id is not valid for this channel.",
  CHANNEL_INVALID: "The channel id is not valid.",
  TIMEOUT: "The request timed out before a Telegram response arrived.",
  NETWORK: "The transport failed before a Telegram response arrived.",
  UNKNOWN: "The failure has no documented class yet.",
};

export function classifyLabError(input: {
  message: string;
  name?: string;
}): ClassifiedLabError {
  const text = `${input.name ?? ""} ${input.message}`;
  const flood = text.match(/FLOOD_WAIT_(\d+)/i);
  if (flood?.[1]) {
    return classified("FLOOD_WAIT", Number(flood[1]));
  }
  if (/AUTH_KEY_DUPLICATED/i.test(text)) {
    return classified("AUTH_KEY_DUPLICATED", null);
  }
  if (/SESSION_REVOKED|AUTH_KEY_UNREGISTERED/i.test(text)) {
    return classified("SESSION_REVOKED", null);
  }
  if (/USER_DEACTIVATED/i.test(text)) {
    return classified("USER_DEACTIVATED", null);
  }
  if (/CHANNEL_PRIVATE/i.test(text)) {
    return classified("CHANNEL_PRIVATE", null);
  }
  if (/MSG_ID_INVALID/i.test(text)) {
    return classified("MSG_ID_INVALID", null);
  }
  if (/CHANNEL_INVALID/i.test(text)) {
    return classified("CHANNEL_INVALID", null);
  }
  if (/timeout|timed out/i.test(text)) {
    return classified("TIMEOUT", null);
  }
  if (/ECONNRESET|EAI_AGAIN|network|socket hang up/i.test(text)) {
    return classified("NETWORK", null);
  }
  return classified("UNKNOWN", null);
}

function classified(
  errorClass: LabErrorClass,
  floodWaitSeconds: number | null,
): ClassifiedLabError {
  return {
    errorClass,
    floodWaitSeconds,
    punitiveBan: false,
    description: CLASS_DESCRIPTIONS[errorClass],
  };
}
