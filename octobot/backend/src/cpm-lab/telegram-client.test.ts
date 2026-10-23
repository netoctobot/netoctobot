import assert from "node:assert/strict";
import test from "node:test";
import { Api } from "teleproto";
import { labCallOptions } from "./readers.js";
import { instrumentInvoke, LAB_CLIENT_OPTIONS, NOT_FULLY_MEASURED, type InvokeLike } from "./telegram-client.js";

test("instance invoke counts library requests and excludes lab requests", async () => {
  const seen: Array<{ name: string; options: unknown }> = [];
  const target: { invoke: InvokeLike } = {
    invoke: async (request, _dcId, options) => {
      seen.push({ name: request.className, options });
      return { ok: true };
    },
  };
  const rpc = instrumentInvoke(target);
  await target.invoke(new Api.updates.GetState());
  await target.invoke(new Api.updates.GetState());
  const options = labCallOptions(new AbortController().signal);
  await rpc.invokeLab(new Api.messages.GetMessagesViews({ peer: "x", id: [1], increment: false }), options);

  assert.deepEqual(rpc.traffic().countedAtInvoke, { "updates.GetState": 2 });
  assert.deepEqual(rpc.traffic().notFullyMeasured, NOT_FULLY_MEASURED);
  assert.equal(seen.length, 3);
  assert.equal(seen[2]?.options, options);
});

test("client options disable automatic flood sleeps and bound retries", () => {
  assert.equal(LAB_CLIENT_OPTIONS.floodSleepThreshold, 0);
  assert.equal(LAB_CLIENT_OPTIONS.requestRetries, 1);
  assert.equal(LAB_CLIENT_OPTIONS.connectionRetries, 3);
  assert.equal(LAB_CLIENT_OPTIONS.reconnectRetries, 3);
});
