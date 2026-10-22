import assert from "node:assert/strict";
import test from "node:test";
import { classifyLabError } from "./errors.js";
import { honorFloodWait } from "./flood-wait.js";

test("documented errors keep their meaning and are not labeled bans", () => {
  const deactivated = classifyLabError({ message: "USER_DEACTIVATED" });
  assert.equal(deactivated.errorClass, "USER_DEACTIVATED");
  assert.equal(deactivated.punitiveBan, false);
  assert.match(deactivated.description, /deleted or deactivated/);

  const flood = classifyLabError({ message: "RPCError 420: FLOOD_WAIT_37" });
  assert.equal(flood.errorClass, "FLOOD_WAIT");
  assert.equal(flood.floodWaitSeconds, 37);
  assert.equal(flood.punitiveBan, false);
});

test("FLOOD_WAIT sleeps for the full returned duration", async () => {
  const slept: number[] = [];
  await honorFloodWait(37, async (milliseconds) => {
    slept.push(milliseconds);
  });
  assert.deepEqual(slept, [37_000]);
});
