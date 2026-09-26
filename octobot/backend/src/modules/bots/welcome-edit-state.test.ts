import assert from "node:assert/strict";
import test from "node:test";
import { SupportedLanguage } from "@prisma/client";
import type { Redis } from "ioredis";
import {
  clearWelcomeEditState,
  getWelcomeEditState,
  saveWelcomeEditState,
  welcomeEditStateKey,
} from "./welcome-edit-state.js";

test("isolates welcome edit state by bot and owner", async () => {
  const values = new Map<string, string>();
  const redis = {
    set: async (key: string, value: string) => {
      values.set(key, value);
      return "OK";
    },
    get: async (key: string) => values.get(key) ?? null,
    del: async (key: string) => {
      values.delete(key);
      return 1;
    },
  } as unknown as Redis;
  const state = {
    chatId: 1,
    dashboardMessageId: 2,
    language: SupportedLanguage.AR,
  };

  await saveWelcomeEditState(redis, "bot-a", 10, state);

  assert.deepEqual(
    await getWelcomeEditState(redis, "bot-a", 10),
    state,
  );
  assert.equal(
    await getWelcomeEditState(redis, "bot-b", 10),
    null,
  );
  await clearWelcomeEditState(redis, "bot-a", 10);
  assert.equal(
    values.has(welcomeEditStateKey("bot-a", 10)),
    false,
  );
});
