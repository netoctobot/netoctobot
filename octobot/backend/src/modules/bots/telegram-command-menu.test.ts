import assert from "node:assert/strict";
import test from "node:test";
import type { Api } from "grammy";
import {
  ensureTelegramCommandMenu,
  mergeStartCommand,
  TELEGRAM_START_DESCRIPTION_AR,
  TELEGRAM_START_DESCRIPTION_EN,
} from "./telegram-command-menu.js";

test("mergeStartCommand keeps other commands and places start first", () => {
  const merged = mergeStartCommand(
    [
      { command: "help", description: "Help" },
      { command: "start", description: "Old start" },
    ],
    TELEGRAM_START_DESCRIPTION_EN,
  );
  assert.deepEqual(merged, [
    { command: "start", description: TELEGRAM_START_DESCRIPTION_EN },
    { command: "help", description: "Help" },
  ]);
});

test("ensureTelegramCommandMenu merges existing commands per locale", async () => {
  const calls: string[] = [];
  const api = {
    getMyCommands: async (other?: { language_code?: string }) => {
      if (!other?.language_code) {
        return [{ command: "help", description: "Help" }];
      }
      return [];
    },
    setMyCommands: async (
      commands: { command: string; description: string }[],
      other?: { language_code?: string },
    ) => {
      const locale = other?.language_code ?? "default";
      calls.push(
        `${locale}:${commands.map((c) => c.command).join(",")}`,
      );
      return true;
    },
    setChatMenuButton: async () => {
      calls.push("menu:commands");
      return true;
    },
  } as unknown as Api;

  await ensureTelegramCommandMenu(api);

  assert.deepEqual(calls, [
    "default:start,help",
    "ar:start",
    "en:start",
    "menu:commands",
  ]);
});

test("ensureTelegramCommandMenu does not throw when Telegram API fails", async () => {
  const api = {
    getMyCommands: async () => [],
    setMyCommands: async () => {
      throw new Error("network down");
    },
    setChatMenuButton: async () => true,
  } as unknown as Api;
  const logs: string[] = [];
  await ensureTelegramCommandMenu(api, (message) => logs.push(message));
  assert.equal(logs.length, 1);
  assert.match(logs[0], /network down/);
});

test("ensureTelegramCommandMenu sets localized start descriptions", async () => {
  const descriptions: Record<string, string> = {};
  const api = {
    getMyCommands: async () => [],
    setMyCommands: async (
      commands: { command: string; description: string }[],
      other?: { language_code?: string },
    ) => {
      const key = other?.language_code ?? "default";
      descriptions[key] = commands.find((c) => c.command === "start")?.description ?? "";
      return true;
    },
    setChatMenuButton: async () => true,
  } as unknown as Api;

  await ensureTelegramCommandMenu(api);

  assert.equal(descriptions.default, TELEGRAM_START_DESCRIPTION_EN);
  assert.equal(descriptions.ar, TELEGRAM_START_DESCRIPTION_AR);
  assert.equal(descriptions.en, TELEGRAM_START_DESCRIPTION_EN);
});
