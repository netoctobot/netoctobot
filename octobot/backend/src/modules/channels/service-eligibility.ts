import { LinkStatus } from "@prisma/client";

export interface ServiceEligibilityState {
  botIsActive: boolean;
  botDeletedAt: Date | null;
  channelIsActive: boolean;
  channelDeletedAt: Date | null;
  linkStatus: LinkStatus;
}

export function isBotChannelServiceEligible(
  state: ServiceEligibilityState,
): boolean {
  return (
    state.botIsActive &&
    state.botDeletedAt === null &&
    state.channelIsActive &&
    state.channelDeletedAt === null &&
    state.linkStatus === LinkStatus.ACTIVE
  );
}
