import assert from "node:assert/strict";
import test from "node:test";
import { BotType, SupportedLanguage, type Bot as DatabaseBot, type PrismaClient } from "@prisma/client";
import { Bot, type Context } from "grammy";
import type { Redis } from "ioredis";
import type { Env } from "../../config/env.js";
import { BotRuntimeManager } from "../bots/bot-runtime-manager.js";
import {
  channelLinkStateKey,
  getChannelLinkState,
} from "../channels/channel-link-state.js";
import { dashboardStateKey, getDashboardState } from "../bots/dashboard-state.js";
import { translate } from "../localization/localization.service.js";
import {
  handleSupportListMyChatMember,
  presentSupportListHome,
  registerSupportListHandlers,
  type SupportListRuntime,
} from "./handlers.js";

const botInfo = {
  id: 777,
  is_bot: true as const,
  first_name: "List",
  username: "sedlistbot",
  can_join_groups: true,
  can_read_all_group_messages: false,
  supports_inline_queries: false,
};

const actor = {
  id: 50,
  is_bot: false as const,
  first_name: "Ada",
};

function callbackUpdate(updateId: number, data: string, messageId: number) {
  return {
    update_id: updateId,
    callback_query: {
      id: `cb-${updateId}`,
      from: actor,
      chat_instance: "instance",
      data,
      message: {
        message_id: messageId,
        date: 1,
        text: "panel",
        chat: { id: actor.id, type: "private" as const, first_name: actor.first_name },
        from: { id: botInfo.id, is_bot: true as const, first_name: botInfo.first_name },
      },
    },
  };
}

function member(status: "administrator" | "creator" | "left", userId: number) {
  return {
    status,
    user: {
      id: userId,
      is_bot: userId === botInfo.id,
      first_name: userId === botInfo.id ? "List" : "Ada",
    },
    ...(status === "administrator"
      ? {
          can_be_edited: false,
          can_manage_chat: true,
          can_change_info: false,
          can_post_messages: true,
          can_edit_messages: true,
          can_delete_messages: true,
          can_invite_users: true,
          can_restrict_members: false,
          can_promote_members: true,
          is_anonymous: false,
        }
      : {}),
    ...(status === "creator" ? { is_anonymous: false } : {}),
  };
}

test("automatic acceptance stays off the add panel and back edits that panel", async () => {
  const calls: Array<{ method: string; payload: Record<string, unknown> }> = [];
  const values = new Map<string, string>();
  const redis = {
    get: async (key: string) => values.get(key) ?? null,
    set: async (key: string, value: string) => {
      values.set(key, value);
      return "OK";
    },
    del: async (key: string) => (values.delete(key) ? 1 : 0),
  } as unknown as Redis;
  const user = {
    id: "user-1",
    telegramId: BigInt(actor.id),
    firstName: actor.first_name,
  };
  const settings = {
    id: "settings-1",
    botId: "bot-1",
    acceptanceMode: "AUTO",
    listName: "Support list",
    contactUrl: null,
  };
  const memberships: Array<{ id: string }> = [];
  const tx = {
    $executeRaw: async () => 1,
    user: {
      upsert: async () => user,
    },
    userBotPreference: {
      upsert: async () => ({
        userId: user.id,
        botId: "bot-1",
        language: SupportedLanguage.AR,
      }),
    },
    supportListSettings: {
      upsert: async () => settings,
    },
    supportListMembership: {
      findFirst: async () => null,
      findMany: async () => [],
      count: async () => memberships.length,
      create: async () => {
        const row = { id: "mem-1" };
        memberships.push(row);
        return row;
      },
    },
    channel: {
      findUnique: async () => null,
      create: async () => ({ id: "ch-1" }),
    },
    wallet: {
      upsert: async () => ({ id: "wallet-1" }),
    },
  };
  const prisma = {
    $transaction: async (callback: (value: typeof tx) => unknown) => callback(tx),
    user: { findUnique: async () => user },
    userBotPreference: {
      findUnique: async () => ({ language: SupportedLanguage.AR }),
    },
    supportListMembership: tx.supportListMembership,
    supportListSettings: tx.supportListSettings,
    supportListPublication: { count: async () => 0 },
    channel: { findUnique: async () => null },
    bot: {
      findFirst: async () => ({ botUsername: "testnetoctobot" }),
    },
  } as unknown as PrismaClient;
  const bot = new Bot("123456:AA", { botInfo });
  bot.api.config.use(async (_previous, method, payload) => {
    const body = (payload ?? {}) as Record<string, unknown>;
    calls.push({ method, payload: body });
    if (method === "sendMessage") {
      return {
        ok: true as const,
        result: {
          message_id: 99,
          date: 3,
          text: String(body.text ?? ""),
          chat: { id: Number(body.chat_id), type: "private" as const },
        },
      };
    }
    if (method === "getChat") {
      return {
        ok: true as const,
        result: {
          id: -100123,
          type: "channel" as const,
          title: "News",
          username: "news",
        },
      };
    }
    if (method === "getChatMember") {
      const userId = Number(body.user_id);
      return {
        ok: true as const,
        result: member(userId === botInfo.id ? "administrator" : "creator", userId),
      };
    }
    if (method === "getChatAdministrators") {
      return { ok: true as const, result: [member("creator", actor.id)] };
    }
    if (method === "getChatMemberCount") {
      return { ok: true as const, result: 10 };
    }
    return {
      ok: true as const,
      result: {
        message_id: Number(body.message_id ?? 40),
        date: 1,
        text: String(body.text ?? ""),
        chat: { id: actor.id, type: "private" as const },
      },
    };
  });
  const record = {
    id: "bot-1",
    ownerId: "owner-1",
    botType: BotType.SUPPORT_LIST_BOT,
    botUsername: "sedlistbot",
    isActive: true,
  } as DatabaseBot;
  const manager = new BotRuntimeManager(
    { WEBHOOK_REGISTRATION_ENABLED: true } as Env,
    prisma,
    redis,
  );
  const runtime = { bot, botRecord: record };
  const panels = manager as unknown as {
    editRuntimeDashboard(
      context: Context,
      runtime: typeof runtime,
      view: { text: string; keyboard: unknown },
    ): Promise<void>;
    showRuntimeDashboard(
      context: Context,
      runtime: typeof runtime,
      view: { text: string; keyboard: unknown },
    ): Promise<void>;
  };
  const deps: SupportListRuntime & { bot: Bot } = {
    prisma,
    redis,
    bot,
    getRecord: () => record,
    getOwnerTelegramId: async () => 999,
    editDashboard: (context, view) =>
      panels.editRuntimeDashboard(context, runtime, view),
    showDashboard: (context, view) =>
      panels.showRuntimeDashboard(context, runtime, view),
  };

  registerSupportListHandlers(bot, deps);
  bot.on("my_chat_member", async (context) => {
    await handleSupportListMyChatMember(context, deps);
  });

  await bot.handleUpdate(callbackUpdate(1, "sl:add", 40));
  assert.deepEqual(await getDashboardState(redis, record.id, actor.id), {
    chatId: actor.id,
    messageId: 40,
  });
  assert.deepEqual(await getChannelLinkState(redis, record.id, actor.id), {
    chatId: actor.id,
    dashboardMessageId: 40,
  });

  const editsBeforeAdd = calls.filter((call) => call.method === "editMessageText");
  await bot.handleUpdate({
    update_id: 2,
    my_chat_member: {
      chat: {
        id: -100123,
        type: "channel" as const,
        title: "News",
        username: "news",
      },
      from: actor,
      date: 2,
      old_chat_member: member("left", botInfo.id),
      new_chat_member: member("administrator", botInfo.id),
    },
  });

  const acceptance = translate(SupportedLanguage.AR, "supportList.submittedAccepted", {
    title: "News",
  });
  const notices = calls.filter(
    (call) => call.method === "sendMessage" && call.payload.text === acceptance,
  );
  assert.equal(notices.length, 1);
  assert.equal(notices[0]?.payload.chat_id, actor.id);
  assert.equal(
    calls.filter((call) => call.method === "editMessageText").length,
    editsBeforeAdd.length,
  );
  assert.equal(await getChannelLinkState(redis, record.id, actor.id), null);
  assert.equal(values.has(channelLinkStateKey(record.id, actor.id)), false);
  assert.deepEqual(await getDashboardState(redis, record.id, actor.id), {
    chatId: actor.id,
    messageId: 40,
  });
  values.set(
    dashboardStateKey(record.id, actor.id),
    JSON.stringify({ chatId: actor.id, messageId: 99 }),
  );

  await bot.handleUpdate(callbackUpdate(3, "sl:home", 40));
  const homeEdits = calls
    .filter((call) => call.method === "editMessageText")
    .slice(editsBeforeAdd.length);
  assert.equal(homeEdits.length, 1);
  assert.equal(homeEdits[0]?.payload.message_id, 40);
  assert.equal(homeEdits[0]?.payload.chat_id, actor.id);
  assert.notEqual(homeEdits[0]?.payload.message_id, 99);
  const homeKeyboard = homeEdits[0]?.payload.reply_markup as {
    inline_keyboard?: Array<Array<{ text?: string; url?: string }>>;
  };
  const createBot = homeKeyboard.inline_keyboard?.at(-1)?.[0];
  assert.equal(createBot?.text, "أنشئ بوتك الخاص");
  assert.equal(createBot?.url, "https://t.me/testnetoctobot");
  assert.deepEqual(
    JSON.parse(values.get(dashboardStateKey(record.id, actor.id)) ?? "{}"),
    { chatId: actor.id, messageId: 40 },
  );
});

test("start add opens the add screen and remembers that panel", async () => {
  const values = new Map<string, string>();
  const redis = {
    get: async (key: string) => values.get(key) ?? null,
    set: async (key: string, value: string) => {
      values.set(key, value);
      return "OK";
    },
    del: async (key: string) => (values.delete(key) ? 1 : 0),
  } as unknown as Redis;
  const user = {
    id: "user-1",
    telegramId: BigInt(actor.id),
    firstName: actor.first_name,
  };
  const prisma = {
    $transaction: async (
      callback: (transaction: {
        user: { upsert: () => Promise<typeof user> };
        userBotPreference: {
          upsert: () => Promise<{ language: SupportedLanguage }>;
        };
      }) => unknown,
    ) =>
      callback({
        user: { upsert: async () => user },
        userBotPreference: {
          upsert: async () => ({ language: SupportedLanguage.AR }),
        },
      }),
  } as unknown as PrismaClient;
  const record = {
    id: "bot-1",
    botUsername: "sed235bot",
    isActive: true,
  } as DatabaseBot;
  let shownText = "";
  const deps: SupportListRuntime = {
    prisma,
    redis,
    getRecord: () => record,
    getOwnerTelegramId: async () => 999,
    showDashboard: async (_context, view) => {
      shownText = view.text;
      values.set(
        dashboardStateKey(record.id, actor.id),
        JSON.stringify({ chatId: actor.id, messageId: 40 }),
      );
    },
    editDashboard: async () => {
      throw new Error("start add must send the add screen as the panel");
    },
  };
  await presentSupportListHome(
    {
      from: { ...actor, language_code: "ar" },
      chat: { id: actor.id, type: "private" },
      match: "add",
    } as Context,
    deps,
  );
  assert.equal(
    shownText,
    translate(SupportedLanguage.AR, "supportList.addInstructions"),
  );
  assert.deepEqual(await getChannelLinkState(redis, record.id, actor.id), {
    chatId: actor.id,
    dashboardMessageId: 40,
  });
});
