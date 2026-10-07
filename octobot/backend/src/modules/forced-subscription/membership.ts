export function isSubscribedStatus(
  status: string,
  isMember?: boolean,
): boolean {
  if (
    status === "creator" ||
    status === "administrator" ||
    status === "member"
  ) {
    return true;
  }
  return status === "restricted" && isMember !== false;
}

export function isChannelAdministrator(status: string): boolean {
  return status === "administrator" || status === "creator";
}

export function publicJoinUrl(username: string | null | undefined): string | null {
  if (!username) {
    return null;
  }
  const name = username.replace(/^@/, "");
  if (!/^[A-Za-z0-9_]{4,}$/.test(name)) {
    return null;
  }
  return `https://t.me/${name}`;
}

export function isSubscriptionExempt(callbackData: string | undefined): boolean {
  if (!callbackData) {
    return false;
  }
  return (
    callbackData === "forced:check" ||
    callbackData === "language:select" ||
    callbackData === "language:set:AR" ||
    callbackData === "language:set:EN"
  );
}

export type MembershipFailure = "unavailable" | "absent";

export function classifyMembershipError(error: unknown): MembershipFailure {
  const description = errorText(error);
  const code = errorCode(error);
  if (code === null) {
    return "unavailable";
  }
  if (code === 429 || code >= 500) {
    return "unavailable";
  }
  if (
    description.includes("user not found") ||
    description.includes("user_not_participant") ||
    description.includes("participant_id_invalid")
  ) {
    return "absent";
  }
  return "unavailable";
}

function errorCode(error: unknown): number | null {
  if (!error || typeof error !== "object" || !("error_code" in error)) {
    return null;
  }
  const code = Number((error as { error_code: unknown }).error_code);
  return Number.isInteger(code) ? code : null;
}

function errorText(error: unknown): string {
  if (!error || typeof error !== "object") {
    return "";
  }
  const record = error as { description?: unknown; message?: unknown };
  const description = typeof record.description === "string" ? record.description : "";
  const message = typeof record.message === "string" ? record.message : "";
  return `${description} ${message}`.toLowerCase();
}
