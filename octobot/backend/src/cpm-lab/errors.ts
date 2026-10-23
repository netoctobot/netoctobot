export const labErrorClasses = [
  "FLOOD_WAIT",
  "AUTH_KEY_DUPLICATED",
  "SESSION_REVOKED",
  "USER_DEACTIVATED",
  "FROZEN",
  "CHANNEL_PRIVATE",
  "MSG_ID_INVALID",
  "CHANNEL_INVALID",
  "PEER_INVALID",
  "MIGRATE",
  "INTEGRITY",
  "TIMEOUT",
  "NETWORK",
  "INTERNAL",
  "ABORTED",
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
  FLOOD_WAIT:
    "Telegram asked the caller to wait before the next request. teleproto 1.230.1 maps FLOOD_PREMIUM_WAIT to the same class, so the two are not distinguished.",
  AUTH_KEY_DUPLICATED: "The lab authorization session is in use elsewhere.",
  SESSION_REVOKED: "The lab session was revoked and needs a manual login.",
  USER_DEACTIVATED: "The account is deleted or deactivated. The cause is unknown.",
  FROZEN: "Telegram reports the account as frozen for this method.",
  CHANNEL_PRIVATE: "The caller has no access to the channel.",
  MSG_ID_INVALID: "The message id is not valid for this channel.",
  CHANNEL_INVALID: "The channel id is not valid.",
  PEER_INVALID: "The peer could not be resolved for this session.",
  MIGRATE: "Telegram asked for another data center. The lab does not follow it automatically.",
  INTEGRITY: "The response did not match the requested channel or message ids.",
  TIMEOUT: "The request timed out before a Telegram response arrived.",
  NETWORK: "The transport failed before a Telegram response arrived.",
  INTERNAL: "Telegram reported an internal server error.",
  ABORTED: "The lab cancelled the request locally after losing the advisory lock.",
  UNKNOWN: "The failure has no documented class yet.",
};

export class LabIntegrityError extends Error {
  constructor(readonly detail: string) {
    super(`CPM lab response failed an integrity check: ${detail}`);
    this.name = "LabIntegrityError";
  }
}

export class LabAbortError extends Error {
  constructor() {
    super("CPM lab request was cancelled because the advisory lock was lost");
    this.name = "LabAbortError";
  }
}

export function classifyLabError(input: {
  message: string;
  name?: string;
}): ClassifiedLabError {
  const text = `${input.name ?? ""} ${input.message}`;
  const flood = text.match(/FLOOD_(?:PREMIUM_)?WAIT_(\d+)/i);
  if (flood?.[1]) {
    return classified("FLOOD_WAIT", Number(flood[1]));
  }
  const byMessage = classifyErrorMessage(text);
  if (byMessage) {
    return classified(byMessage, null);
  }
  if (/timeout|timed out/i.test(text)) {
    return classified("TIMEOUT", null);
  }
  if (
    /ECONNRESET|ECONNREFUSED|EAI_AGAIN|ETIMEDOUT|EPIPE|network|socket hang up|not connected|disconnected/i.test(
      text,
    )
  ) {
    return classified("NETWORK", null);
  }
  return classified("UNKNOWN", null);
}

/**
 * Reads the teleproto error class, `seconds`, `errorMessage`, and `code`.
 * In teleproto 1.230.1 FloodWaitError has errorMessage "FLOOD", code 420, and
 * a numeric `seconds`. Its message is "Please wait N seconds...", which the
 * text classifier alone does not match.
 */
export function classifyThrown(error: unknown): ClassifiedLabError {
  if (error instanceof LabIntegrityError) {
    return classified("INTEGRITY", null);
  }
  if (error instanceof LabAbortError) {
    return classified("ABORTED", null);
  }
  const fields = errorFields(error);
  if (
    fields.seconds !== null &&
    (fields.name === "FloodWaitError" ||
      fields.name === "FloodPremiumWaitError" ||
      fields.errorMessage === "FLOOD" ||
      fields.code === 420)
  ) {
    return classified("FLOOD_WAIT", fields.seconds);
  }
  if (fields.errorMessage) {
    const byMessage = classifyErrorMessage(fields.errorMessage);
    if (byMessage) {
      return classified(byMessage, null);
    }
  }
  if (fields.code === 303) {
    return classified("MIGRATE", null);
  }
  if (fields.name === "TimeoutError" || fields.errorMessage === "Timeout") {
    return classified("TIMEOUT", null);
  }
  if (fields.code !== null && fields.code >= 500) {
    return classified("INTERNAL", null);
  }
  return classifyLabError({ message: fields.message, name: fields.name });
}

function classifyErrorMessage(text: string): LabErrorClass | null {
  if (/AUTH_KEY_DUPLICATED/i.test(text)) {
    return "AUTH_KEY_DUPLICATED";
  }
  if (/SESSION_REVOKED|AUTH_KEY_UNREGISTERED|SESSION_EXPIRED/i.test(text)) {
    return "SESSION_REVOKED";
  }
  if (/USER_DEACTIVATED/i.test(text)) {
    return "USER_DEACTIVATED";
  }
  if (/FROZEN_/i.test(text)) {
    return "FROZEN";
  }
  if (/CHANNEL_PRIVATE/i.test(text)) {
    return "CHANNEL_PRIVATE";
  }
  if (/MSG_ID_INVALID/i.test(text)) {
    return "MSG_ID_INVALID";
  }
  if (/CHANNEL_INVALID/i.test(text)) {
    return "CHANNEL_INVALID";
  }
  if (/PEER_ID_INVALID|USERNAME_NOT_OCCUPIED|USERNAME_INVALID|INVITE_HASH_(INVALID|EXPIRED)/i.test(text)) {
    return "PEER_INVALID";
  }
  if (/_MIGRATE_\d+/i.test(text)) {
    return "MIGRATE";
  }
  return null;
}

function errorFields(error: unknown): {
  name: string;
  message: string;
  errorMessage: string | null;
  code: number | null;
  seconds: number | null;
} {
  if (typeof error !== "object" || error === null) {
    return { name: "", message: String(error), errorMessage: null, code: null, seconds: null };
  }
  const record = error as Record<string, unknown>;
  const seconds = record.seconds;
  return {
    name: typeof record.name === "string" ? record.name : "",
    message: typeof record.message === "string" ? record.message : "",
    errorMessage: typeof record.errorMessage === "string" ? record.errorMessage : null,
    code: typeof record.code === "number" ? record.code : null,
    seconds:
      typeof seconds === "number" && Number.isInteger(seconds) && seconds >= 0 ? seconds : null,
  };
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
