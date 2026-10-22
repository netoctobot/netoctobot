import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";
import { LogLevel } from "teleproto/extensions/Logger.js";
import {
  buildChannelsGetMessages,
  buildUserViewsRequest,
  RedactingLabLogger,
  verifiedTeleproto,
} from "./teleproto-surface.js";

const require = createRequire(import.meta.url);
const teleprotoPackage = require("teleproto/package.json") as {
  version: string;
  license: string;
};

test("installed teleproto matches the verified MTProto surface", () => {
  assert.equal(teleprotoPackage.version, verifiedTeleproto.version);
  assert.equal(teleprotoPackage.license, verifiedTeleproto.license);

  const channelRead = buildChannelsGetMessages("fixture_channel", [41, 42]);
  const userViews = buildUserViewsRequest("fixture_channel", [41, 42]);

  assert.equal(channelRead.className, "channels.GetMessages");
  assert.equal(channelRead.CONSTRUCTOR_ID, verifiedTeleproto.channelsGetMessagesConstructorId);
  assert.equal("increment" in channelRead, false);
  assert.equal(channelRead.id.length, 2);

  assert.equal(userViews.className, "messages.GetMessagesViews");
  assert.equal(
    userViews.CONSTRUCTOR_ID,
    verifiedTeleproto.messagesGetMessagesViewsConstructorId,
  );
  assert.equal(userViews.increment, false);
});

test("the library logger redacts secrets before they are written", () => {
  const secret = "lab-session-1:this-is-a-long-session-secret";
  const lines: string[] = [];
  const logger = new RedactingLabLogger([secret], (line) => lines.push(line));

  logger.log(LogLevel.ERROR, `connect failed ${secret}`, new Error(`stack ${secret}`));

  assert.equal(lines.length, 1);
  assert.equal(lines[0]?.includes(secret), false);
  assert.match(lines[0] ?? "", /\[redacted\]/);
});
