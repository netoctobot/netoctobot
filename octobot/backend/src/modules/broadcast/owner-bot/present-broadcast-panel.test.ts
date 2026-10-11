import assert from "node:assert/strict";
import test from "node:test";
import type { Context } from "grammy";
import type { ManagedBotRuntime } from "../../bots/bot-runtime-manager.js";
import { presentBroadcastPanel } from "./register-owner-broadcast.js";
import type { OwnerBroadcastDeps } from "./register-owner-broadcast.js";

const view = { text: "panel", keyboard: undefined as never };
const runtime = { bot: {}, botRecord: { id: "b1" } } as ManagedBotRuntime;

test("presentBroadcastPanel edits in place for callback queries", async () => {
  let edited = 0;
  let shown = 0;
  const deps = {
    editDashboard: async () => {
      edited += 1;
    },
    showDashboard: async () => {
      shown += 1;
    },
  } as Pick<OwnerBroadcastDeps, "editDashboard" | "showDashboard"> as OwnerBroadcastDeps;
  const context = { callbackQuery: { id: "1" } } as Context;
  await presentBroadcastPanel(deps, context, runtime, view);
  assert.equal(edited, 1);
  assert.equal(shown, 0);
});

test("presentBroadcastPanel uses showDashboard without callback", async () => {
  let edited = 0;
  let shown = 0;
  const deps = {
    editDashboard: async () => {
      edited += 1;
    },
    showDashboard: async () => {
      shown += 1;
    },
  } as Pick<OwnerBroadcastDeps, "editDashboard" | "showDashboard"> as OwnerBroadcastDeps;
  const context = {} as Context;
  await presentBroadcastPanel(deps, context, runtime, view);
  assert.equal(edited, 0);
  assert.equal(shown, 1);
});
