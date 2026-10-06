import { ADMIN_REASON_LIMIT } from "../support-list/constants.js";

export function normalizeAdminReason(input: string): string | null {
  const reason = input.replace(/\s+/g, " ").trim();
  if (reason.length < 1 || reason.length > ADMIN_REASON_LIMIT) {
    return null;
  }
  return reason;
}
