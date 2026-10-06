export const ADMIN_REASON_LIMIT = 200;

export function normalizeAdminReason(input: string): string | null {
  const reason = input.replace(/\s+/g, " ").trim();
  if (reason.length < 1 || reason.length > ADMIN_REASON_LIMIT) {
    return null;
  }
  return reason;
}
