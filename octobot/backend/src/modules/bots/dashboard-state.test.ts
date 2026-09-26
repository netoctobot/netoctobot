import assert from "node:assert/strict";
import test from "node:test";
import { dashboardStateKey } from "./dashboard-state.js";

test("isolates dashboard state by bot and user", () => {
  assert.notEqual(
    dashboardStateKey("bot-a", 123),
    dashboardStateKey("bot-b", 123),
  );
  assert.notEqual(
    dashboardStateKey("bot-a", 123),
    dashboardStateKey("bot-a", 456),
  );
});
