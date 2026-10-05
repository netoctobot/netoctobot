import { MAX_ACCEPTED_CHANNELS } from "./constants.js";

export type AcceptanceStatus = "PENDING" | "ACCEPTED" | "REJECTED";

export interface DisableFlags {
  participantDisabled: boolean;
  adminDisabled: boolean;
  adminDisableReason: string | null;
  permissionsLost: boolean;
  inviteUnavailable: boolean;
}

export type DisableReasonCode =
  | "participant"
  | "admin"
  | "permissions"
  | "invite";

export function disableReasonCodes(
  flags: DisableFlags,
): DisableReasonCode[] {
  const reasons: DisableReasonCode[] = [];
  if (flags.participantDisabled) {
    reasons.push("participant");
  }
  if (flags.adminDisabled) {
    reasons.push("admin");
  }
  if (flags.permissionsLost) {
    reasons.push("permissions");
  }
  if (flags.inviteUnavailable) {
    reasons.push("invite");
  }
  return reasons;
}

export function occupiesAcceptedSlot(input: {
  acceptanceStatus: AcceptanceStatus;
  deletedAt: Date | null;
}): boolean {
  return (
    input.acceptanceStatus === "ACCEPTED" && input.deletedAt === null
  );
}

export function isPublishable(
  input: {
    acceptanceStatus: AcceptanceStatus;
    deletedAt: Date | null;
  } & DisableFlags,
): boolean {
  return (
    occupiesAcceptedSlot(input) &&
    disableReasonCodes(input).length === 0
  );
}

export function claimAcceptedSlot(
  acceptedCount: number,
  max = MAX_ACCEPTED_CHANNELS,
): boolean {
  return acceptedCount < max;
}

export function acceptanceDecision(input: {
  mode: "AUTO" | "MANUAL";
  acceptedCount: number;
}): "accept" | "pending" | "full" {
  if (input.mode === "MANUAL") {
    return "pending";
  }
  return claimAcceptedSlot(input.acceptedCount) ? "accept" : "full";
}
