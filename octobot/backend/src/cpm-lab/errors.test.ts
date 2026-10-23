import assert from "node:assert/strict";
import test from "node:test";
import { errors } from "teleproto";
import { classifyLabError, classifyThrown, LabAbortError, LabIntegrityError } from "./errors.js";

test("teleproto FloodWaitError is classified by class and seconds, not by message text", () => {
  const flood = new errors.FloodWaitError({ capture: "37", request: undefined } as never);
  assert.match(flood.message, /wait 37 seconds/i);
  assert.equal(classifyLabError({ message: flood.message, name: flood.name }).errorClass, "UNKNOWN");
  const classified = classifyThrown(flood);
  assert.equal(classified.errorClass, "FLOOD_WAIT");
  assert.equal(classified.floodWaitSeconds, 37);
  assert.match(classified.description, /FLOOD_PREMIUM_WAIT/);
});

test("teleproto RPC error classes map through errorMessage and code", () => {
  const cases: Array<[unknown, string]> = [
    [new errors.ChannelPrivateError({ request: undefined } as never), "CHANNEL_PRIVATE"],
    [new errors.AuthKeyDuplicatedError({ request: undefined } as never), "AUTH_KEY_DUPLICATED"],
    [new errors.AuthKeyUnregisteredError({ request: undefined } as never), "SESSION_REVOKED"],
    [new errors.SessionRevokedError({ request: undefined } as never), "SESSION_REVOKED"],
    [new errors.UserDeactivatedBanError({ request: undefined } as never), "USER_DEACTIVATED"],
    [new errors.MsgIdInvalidError({ request: undefined } as never), "MSG_ID_INVALID"],
    [new errors.ChannelInvalidError({ request: undefined } as never), "CHANNEL_INVALID"],
    [new errors.FrozenMethodInvalidError({ request: undefined } as never), "FROZEN"],
    [new errors.PeerIdInvalidError({ request: undefined } as never), "PEER_INVALID"],
  ];
  for (const [error, expected] of cases) {
    assert.equal(classifyThrown(error).errorClass, expected, String((error as Error).name));
  }
});

test("timeouts, server errors, migrations, and transport failures", () => {
  const rpcTimeout = new Error("RPC timed out after 20000ms");
  rpcTimeout.name = "TimeoutError";
  assert.equal(classifyThrown(rpcTimeout).errorClass, "TIMEOUT");
  assert.equal(classifyThrown({ name: "ServerError", errorMessage: "WORKER_BUSY", code: 500 }).errorClass, "INTERNAL");
  assert.equal(classifyThrown({ name: "InvalidDCError", errorMessage: "NETWORK_MIGRATE_2", code: 303 }).errorClass, "MIGRATE");
  assert.equal(classifyThrown(new Error("Not connected")).errorClass, "NETWORK");
  assert.equal(classifyThrown(new LabIntegrityError("x")).errorClass, "INTEGRITY");
  assert.equal(classifyThrown(new LabAbortError()).errorClass, "ABORTED");
  assert.equal(classifyThrown(new Error("something else")).errorClass, "UNKNOWN");
});
