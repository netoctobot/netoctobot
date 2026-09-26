import assert from "node:assert/strict";
import test from "node:test";
import { Bot, type Context } from "grammy";
import {
  isPrivateSlashCommand,
  PRIVATE_HOME_COMMAND_PATTERN,
} from "./slash-command.js";

const botInfo = {
  id: 1,
  is_bot: true as const,
  first_name: "Octobot",
  username: "octobot",
  can_join_groups: true,
  can_read_all_group_messages: false,
  supports_inline_queries: false,
};

function startUpdate(entities?: Array<{
  offset: number;
  length: number;
  type: "bot_command";
}>) {
  return {
    update_id: 1,
    message: {
      message_id: 10,
      from: { id: 42, is_bot: false, first_name: "Ada" },
      chat: { id: 42, first_name: "Ada", type: "private" as const },
      date: 1,
      text: "/start",
      ...(entities ? { entities } : {}),
    },
  };
}

async function handleWith(
  register: (bot: Bot, onStart: (context: Context) => Promise<void>) => void,
  update: ReturnType<typeof startUpdate>,
): Promise<string[]> {
  const methods: string[] = [];
  const bot = new Bot("123456789:AA", { botInfo });
  bot.api.config.use(async (_prev, method, payload) => {
    methods.push(method);
    return {
      ok: true,
      result: {
        message_id: 11,
        date: 1,
        chat: { id: 42, type: "private" },
        text: "payload" in payload ? String(payload.text ?? "") : "",
      },
    };
  });

  register(bot, async (context) => {
    await context.reply("home");
  });
  await bot.handleUpdate(update);
  return methods;
}

test("detects /start even when the bot username or payload is present", () => {
  assert.equal(isPrivateSlashCommand("/start", "start"), true);
  assert.equal(isPrivateSlashCommand("/start@octobot", "start"), true);
  assert.equal(isPrivateSlashCommand("/start payload", "start"), true);
  assert.equal(isPrivateSlashCommand("/cancel", "start"), false);
  assert.equal(isPrivateSlashCommand("start", "start"), false);
});

test("command-only handlers miss /start without bot_command entities", async () => {
  const methods = await handleWith((bot, onStart) => {
    bot.command("start", onStart);
    bot.on("message", async () => undefined);
  }, startUpdate());

  assert.equal(methods.includes("sendMessage"), false);
});

test("text fallback replies to /start without bot_command entities", async () => {
  const methods = await handleWith((bot, onStart) => {
    bot.command("start", onStart);
    bot.hears(PRIVATE_HOME_COMMAND_PATTERN, onStart);
    bot.on("message", async () => undefined);
  }, startUpdate());

  assert.equal(methods.includes("sendMessage"), true);
});

test("catch-all message handler does not swallow skipped slash commands when hears runs", async () => {
  const methods = await handleWith((bot, onStart) => {
    bot.command("start", onStart);
    bot.hears(PRIVATE_HOME_COMMAND_PATTERN, onStart);
    bot.on("message", async (context) => {
      if (
        isPrivateSlashCommand(context.message.text, "start") ||
        isPrivateSlashCommand(context.message.text, "cancel")
      ) {
        return;
      }
    });
  }, startUpdate());

  assert.equal(methods.includes("sendMessage"), true);
});

test("command handler still replies when Telegram includes entities", async () => {
  const methods = await handleWith((bot, onStart) => {
    bot.command("start", onStart);
    bot.on("message", async () => undefined);
  }, startUpdate([{ offset: 0, length: 6, type: "bot_command" }]));

  assert.equal(methods.includes("sendMessage"), true);
});
