import assert from "node:assert/strict";
import test from "node:test";
import type { PrismaClient } from "@prisma/client";
import {
  activateCatalogChannel,
  addCatalogChannel,
  type CatalogTelegram,
} from "./catalog-admin.js";
import {
  classifyMembershipError,
  isChannelAdministrator,
  isSubscribedStatus,
  isSubscriptionExempt,
} from "./membership.js";

test("subscription status ignores a stored opt-out and treats network loss as unavailable", () => {
  assert.equal(isSubscribedStatus("member"), true);
  assert.equal(isSubscribedStatus("administrator"), true);
  assert.equal(isSubscribedStatus("left"), false);
  assert.equal(isSubscribedStatus("restricted", false), false);
  assert.equal(isChannelAdministrator("member"), false);
  assert.equal(isChannelAdministrator("administrator"), true);
  assert.equal(isSubscriptionExempt("language:set:AR"), true);
  assert.equal(isSubscriptionExempt("forced:check"), true);
  assert.equal(isSubscriptionExempt("menu:home"), false);
  assert.equal(classifyMembershipError(new Error("socket hang up")), "unavailable");
  assert.equal(classifyMembershipError({ error_code: 429, description: "retry" }), "unavailable");
  assert.equal(
    classifyMembershipError({ error_code: 400, description: "Bad Request: user not found" }),
    "absent",
  );
  assert.equal(
    classifyMembershipError({ error_code: 400, description: "Bad Request: chat not found" }),
    "unavailable",
  );
});

test("adding a catalog channel does not change an existing owner", async () => {
  const updates: unknown[] = [];
  const prisma = {
    channel: {
      async findUnique() {
        return {
          id: "channel-1",
          ownerId: "real-owner",
          telegramOwnerId: 99n,
          platformForcedCatalog: null,
        };
      },
      async update({ data }: { data: Record<string, unknown> }) {
        updates.push(data);
        return data;
      },
      async create() {
        throw new Error("existing channel was recreated");
      },
    },
    user: { async findUnique() { return null; } },
    platformForcedChannel: {
      async count() { return 0; },
      async create() { return { id: "catalog-1" }; },
    },
    auditLog: { async create() { return { id: "audit" }; } },
  } as unknown as PrismaClient;
  const telegram: CatalogTelegram = {
    async getMe() { return { id: 1 }; },
    async getChat() { return { id: -100123, type: "channel", title: "News", username: "news" }; },
    async getChatMember() { return { status: "administrator" }; },
    async getChatAdministrators() { return [{ status: "creator", user: { id: 5 } }]; },
    async createChatInviteLink() { return { invite_link: "https://t.me/+abc" }; },
    async exportChatInviteLink() { return "https://t.me/+abc"; },
  };
  const added = await addCatalogChannel(prisma, telegram, "iamadmin", "@newsch", "127.0.0.1");
  assert.equal(added.ok, true);
  assert.deepEqual(updates, [{ isPlatformCatalog: true, title: "News", username: "news" }]);
});

test("a new catalog channel records the creator only when that user already exists", async () => {
  const created: Array<Record<string, unknown>> = [];
  const prisma = {
    channel: {
      async findUnique() {
        return null;
      },
      async create({ data }: { data: Record<string, unknown> }) {
        created.push(data);
        return { id: "channel-new" };
      },
    },
    user: {
      async findUnique() {
        return null;
      },
    },
    platformForcedChannel: {
      async count() {
        return 0;
      },
      async create() {
        return { id: "catalog-new" };
      },
    },
    auditLog: { async create() { return { id: "audit" }; } },
  } as unknown as PrismaClient;
  const telegram: CatalogTelegram = {
    async getMe() { return { id: 1 }; },
    async getChat() { return { id: -100777, type: "channel", title: "Fresh" }; },
    async getChatMember() { return { status: "creator" }; },
    async getChatAdministrators() { return [{ status: "creator", user: { id: 42 } }]; },
    async createChatInviteLink() { return { invite_link: "https://t.me/+fresh" }; },
    async exportChatInviteLink() { return "https://t.me/+fresh"; },
  };
  const added = await addCatalogChannel(prisma, telegram, "iamadmin", "@freshchannel", "127.0.0.1");
  assert.equal(added.ok, true);
  assert.equal(created[0]?.ownerId, undefined);
  assert.equal(created[0]?.telegramOwnerId, 42n);
  assert.equal(created[0]?.isPlatformCatalog, true);
});

test("activation requires an administrator status and a private join link", async () => {
  const stored: Array<Record<string, unknown>> = [];
  const prisma = {
    platformForcedChannel: {
      async findUnique() {
        return {
          id: "catalog-1",
          channel: { channelTelegramId: -100555n, username: null, title: "Private" },
        };
      },
      async update({ data }: { data: Record<string, unknown> }) {
        stored.push(data);
        return { id: "catalog-1", isActive: true };
      },
    },
    auditLog: { async create() { return { id: "audit" }; } },
  } as unknown as PrismaClient;
  const memberStatus = { current: "member" };
  const telegram: CatalogTelegram = {
    async getMe() { return { id: 7 }; },
    async getChat() { return { id: -100555, type: "channel", title: "Private" }; },
    async getChatMember() { return { status: memberStatus.current }; },
    async getChatAdministrators() { return []; },
    async createChatInviteLink() { throw new Error("no invite"); },
    async exportChatInviteLink() { return ""; },
  };
  const rejected = await activateCatalogChannel(prisma, telegram, "iamadmin", "catalog-1", undefined);
  assert.deepEqual(rejected, { ok: false, error: "catalog_not_admin" });
  memberStatus.current = "administrator";
  const noLink = await activateCatalogChannel(prisma, telegram, "iamadmin", "catalog-1", undefined);
  assert.deepEqual(noLink, { ok: false, error: "catalog_join_unavailable" });
  telegram.exportChatInviteLink = async () => "https://t.me/+private";
  const activated = await activateCatalogChannel(prisma, telegram, "iamadmin", "catalog-1", undefined);
  assert.equal(activated.ok, true);
  assert.equal(stored[0]?.joinUrl, "https://t.me/+private");
  assert.equal(stored[0]?.isActive, true);
});
