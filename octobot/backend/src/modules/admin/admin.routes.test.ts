import assert from "node:assert/strict";
import test from "node:test";
import Fastify from "fastify";
import { type PrismaClient, SupportedLanguage } from "@prisma/client";
import type { Env } from "../../config/env.js";
import { ADMIN_SESSION_COOKIE } from "./admin-session.js";
import { registerAdminRoutes } from "./admin.routes.js";

const nowMs = 1_700_000_000_000 + 5_000;
const owner = {
  id: "user_owner",
  telegramId: 123456789n,
  username: "owner",
  firstName: "Owner",
  lastName: null,
  deletedAt: null,
};

const env = {
  BOT_TOKEN: "test-token",
  OWNER_TELEGRAM_ID: 123456789n,
  ENCRYPTION_KEY: "00".repeat(32),
  PUBLIC_BASE_URL: "http://localhost:3000",
} as Env;

function createHarness() {
  const calls: string[] = [];
  const catalog = [
    { id: "cat_a", isActive: true, sortOrder: 0 },
    { id: "cat_b", isActive: true, sortOrder: 1 },
  ];
  let locale: SupportedLanguage | null = null;
  const prisma = {
    user: {
      async findUnique({
        where,
      }: {
        where: { id?: string; telegramId?: bigint };
      }) {
        if (where.telegramId !== undefined) {
          return where.telegramId === owner.telegramId ? owner : null;
        }
        return where.id === owner.id ? owner : null;
      },
      async update({
        data,
      }: {
        data: { firstName?: string; username?: string };
      }) {
        return { ...owner, ...data };
      },
    },
    userBotPreference: new Proxy(
      {},
      {
        get() {
          return () => {
            throw new Error("bot preference touched");
          };
        },
      },
    ),
    webLocalePreference: {
      async findUnique() {
        return locale ? { language: locale, isExplicit: true } : null;
      },
      async upsert({
        create,
      }: {
        create: { language: SupportedLanguage };
      }) {
        calls.push("web-locale");
        locale = create.language;
        return { language: locale, isExplicit: true };
      },
    },
    platformSettings: {
      async findUnique() {
        return { platformBot: { botUsername: "platform_bot" } };
      },
    },
    platformForcedChannel: {
      async findMany() {
        return catalog.map((row) => ({ id: row.id }));
      },
      async findUnique({ where }: { where: { id: string } }) {
        return catalog.find((row) => row.id === where.id) ?? null;
      },
      async update({
        where,
        data,
      }: {
        where: { id: string };
        data: { isActive?: boolean; sortOrder?: number };
      }) {
        const row = catalog.find((item) => item.id === where.id);
        Object.assign(row ?? {}, data);
        return row;
      },
    },
    forcedSubscription: new Proxy(
      {},
      {
        get() {
          return () => {
            throw new Error("forced subscription touched");
          };
        },
      },
    ),
    supportListMembership: {
      async findFirst({
        where,
      }: {
        where: { id: string; botId: string; deletedAt: null };
      }) {
        if (where.id === "mem_1" && where.botId === "bot_1" && where.deletedAt === null) {
          return { id: "mem_1" };
        }
        return null;
      },
      async update({
        data,
      }: {
        data: { adminDisableReason: string };
      }) {
        return {
          id: "mem_1",
          adminDisabled: true,
          adminDisableReason: data.adminDisableReason,
        };
      },
    },
    auditLog: {
      async create({ data }: { data: { action: string } }) {
        calls.push(data.action);
        return { id: "audit" };
      },
    },
    async $transaction(operations: Array<Promise<unknown>>) {
      return Promise.all(operations);
    },
  } as unknown as PrismaClient;

  const app = Fastify({ logger: false });
  registerAdminRoutes(app, env, prisma, { now: () => nowMs });
  return { app, calls };
}

test("owner session restores web language without bot preferences", async () => {
  const { app, calls } = createHarness();
  const login = await app.inject({
    method: "POST",
    url: "/admin/session",
    payload: {
      id: "123456789",
      first_name: "Owner",
      auth_date: "1700000000",
      hash: "446b7292f75b2f68995f9a146626d0e4b4a690b6137b7512cca49bae583c43ab",
    },
  });
  assert.equal(login.statusCode, 200);
  assert.equal(login.json().webLocale, null);
  assert.equal(calls.includes("web-locale"), false);

  const setCookie = login.headers["set-cookie"];
  assert.equal(typeof setCookie, "string");
  assert.match(String(setCookie), new RegExp(`${ADMIN_SESSION_COOKIE}=`));

  const denied = await app.inject({ method: "GET", url: "/admin/overview" });
  assert.equal(denied.statusCode, 401);

  const saved = await app.inject({
    method: "PUT",
    url: "/admin/locale",
    headers: { cookie: String(setCookie) },
    payload: { language: "AR" },
  });
  assert.equal(saved.statusCode, 200);
  assert.equal(saved.json().language, "AR");

  const me = await app.inject({
    method: "GET",
    url: "/admin/me",
    headers: { cookie: String(setCookie) },
  });
  assert.equal(me.json().webLocale, "AR");
  assert.equal(calls.includes("web_locale.set"), true);
  await app.close();
});

test("catalog reorder and admin disable stay off forced subscriptions", async () => {
  const { app, calls } = createHarness();
  const login = await app.inject({
    method: "POST",
    url: "/admin/session",
    payload: {
      id: 123456789,
      first_name: "Owner",
      auth_date: 1700000000,
      hash: "446b7292f75b2f68995f9a146626d0e4b4a690b6137b7512cca49bae583c43ab",
    },
  });
  const cookie = String(login.headers["set-cookie"]);
  const reorder = await app.inject({
    method: "PUT",
    url: "/admin/catalog/order",
    headers: { cookie },
    payload: { ids: ["cat_b", "cat_a"] },
  });
  assert.equal(reorder.statusCode, 200);
  const disabled = await app.inject({
    method: "POST",
    url: "/admin/publishing/bot_1/memberships/mem_1/admin-disable",
    headers: { cookie },
    payload: { reason: "  repeated   spam  " },
  });
  assert.equal(disabled.statusCode, 200);
  assert.equal(disabled.json().adminDisableReason, "repeated spam");
  assert.equal(calls.includes("catalog.reorder"), true);
  assert.equal(calls.includes("support_list.admin_disable"), true);
  const outsider = await app.inject({
    method: "POST",
    url: "/admin/session",
    payload: {
      id: "999",
      first_name: "Other",
      auth_date: "1700000000",
      hash: "446b7292f75b2f68995f9a146626d0e4b4a690b6137b7512cca49bae583c43ab",
    },
  });
  assert.equal(outsider.statusCode, 401);
  await app.close();
});
