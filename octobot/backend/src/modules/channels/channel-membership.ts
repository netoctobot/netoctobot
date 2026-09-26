import type { ChatMember } from "grammy/types";
import { hasRequiredChannelRights } from "./channel.service.js";

export type ChannelMembershipOutcome =
  | "VALID"
  | "BOT_REMOVED"
  | "PERMISSIONS_LOST";

export function classifyChannelMembership(
  membership: ChatMember,
): ChannelMembershipOutcome {
  if (hasRequiredChannelRights(membership)) {
    return "VALID";
  }
  return membership.status === "administrator" ||
    membership.status === "creator"
    ? "PERMISSIONS_LOST"
    : "BOT_REMOVED";
}
