import assert from "node:assert/strict";
import test from "node:test";
import { LinkStatus } from "@prisma/client";
import { isBotChannelServiceEligible } from "./service-eligibility.js";

const active = {
  botIsActive: true,
  botDeletedAt: null,
  channelIsActive: true,
  channelDeletedAt: null,
  linkStatus: LinkStatus.ACTIVE,
};

test("requires every bot, channel, and link state to be operational", () => {
  assert.equal(isBotChannelServiceEligible(active), true);

  for (const state of [
    { ...active, botIsActive: false },
    { ...active, botDeletedAt: new Date() },
    { ...active, channelIsActive: false },
    { ...active, channelDeletedAt: new Date() },
    { ...active, linkStatus: LinkStatus.INACTIVE },
  ]) {
    assert.equal(isBotChannelServiceEligible(state), false);
  }
});
