import assert from "node:assert/strict";
import test from "node:test";
import {
  BotType,
  LinkStatus,
  type Bot,
  type PrismaClient,
} from "@prisma/client";
import type { Redis } from "ioredis";
import type { Env } from "../../config/env.js";
import {
  BotRuntimeManager,
  deriveWebhookSecret,
  isBotTokenFormatValid,
} from "./bot-runtime-manager.js";

test("validates Telegram bot token shape without logging the token", () => {
  assert.equal(
    isBotTokenFormatValid(
      "1234567890:abcdefghijklmnopqrstuvwxyzABCDE_12345",
    ),
    true,
  );
  assert.equal(isBotTokenFormatValid("not-a-token"), false);
});

test("derives stable bot-specific webhook secrets", () => {
  const first = deriveWebhookSecret("master-secret", "bot-a");
  const repeated = deriveWebhookSecret("master-secret", "bot-a");
  const otherBot = deriveWebhookSecret("master-secret", "bot-b");

  assert.equal(first, repeated);
  assert.notEqual(first, otherBot);
  assert.match(first, /^[a-f0-9]{64}$/);
});

function lifecycleManager() {
  const record = {
    id: "bot-id",
    ownerId: "owner-id",
    botType: BotType.CONTACT_BOT,
    deletedAt: null,
    isActive: true,
  } as Bot;
  const botUpdates: unknown[] = [];
  const linkUpdates: unknown[] = [];
  const audits: unknown[] = [];
  const transaction = {
    bot: {
      update: async (value: unknown) => {
        botUpdates.push(value);
        return { ...record, isActive: false };
      },
    },
    botChannelLink: {
      updateMany: async (value: unknown) => {
        linkUpdates.push(value);
        return { count: 1 };
      },
    },
    auditLog: {
      create: async (value: unknown) => {
        audits.push(value);
        return {};
      },
    },
  };
  const prisma = {
    bot: {
      findFirst: async () => record,
    },
    $transaction: async (
      callback: (value: typeof transaction) => unknown,
    ) => callback(transaction),
  } as unknown as PrismaClient;
  const env = {
    WEBHOOK_REGISTRATION_ENABLED: false,
  } as Env;
  return {
    manager: new BotRuntimeManager(
      env,
      prisma,
      {} as Redis,
    ),
    botUpdates,
    linkUpdates,
    audits,
  };
}

test("deactivates the bot runtime state and all channel links", async () => {
  const value = lifecycleManager();

  await value.manager.deactivateUserBot("owner-id", "bot-id");

  assert.deepEqual(value.botUpdates[0], {
    where: { id: "bot-id" },
    data: { isActive: false, deletedAt: null },
  });
  const linkUpdate = value.linkUpdates[0] as {
    data: {
      status: LinkStatus;
      deactivationReason: string;
    };
  };
  assert.equal(linkUpdate.data.status, LinkStatus.INACTIVE);
  assert.equal(
    linkUpdate.data.deactivationReason,
    "BOT_DEACTIVATED",
  );
});

test("soft-deletes a bot without deleting its historical row", async () => {
  const value = lifecycleManager();

  await value.manager.softDeleteUserBot("owner-id", "bot-id");

  const update = value.botUpdates[0] as {
    data: { isActive: boolean; deletedAt: Date };
  };
  assert.equal(update.data.isActive, false);
  assert.ok(update.data.deletedAt instanceof Date);
  const linkUpdate = value.linkUpdates[0] as {
    data: { deactivationReason: string };
  };
  assert.equal(
    linkUpdate.data.deactivationReason,
    "BOT_DELETED",
  );
  assert.equal(value.audits.length, 1);
});
