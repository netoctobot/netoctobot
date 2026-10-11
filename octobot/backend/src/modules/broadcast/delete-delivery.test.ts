import assert from "node:assert/strict";
import test from "node:test";
import { GrammyError } from "grammy";
import type { Api } from "grammy";
import type { PrismaClient } from "@prisma/client";
import { encryptToken } from "../../lib/token-crypto.js";
import {
  classifyDeleteError,
  executeBroadcastMessageDelete,
  resolveDeleteTarget,
} from "./delete-delivery.js";

const TEST_KEY = "a".repeat(64);
const ENCRYPTED_TOKEN = encryptToken("123:ABC", TEST_KEY);

test("classifyDeleteError maps not found to gone and cannot delete to unavailable", () => {
  const gone = new GrammyError(
    "Bad Request: message to delete not found",
    { ok: false, error_code: 400, description: "Bad Request: message to delete not found" },
    "deleteMessage",
    {},
  );
  assert.deepEqual(classifyDeleteError(gone), { action: "gone", reason: "message_not_found" });

  const cannot = new GrammyError(
    "Bad Request: message can't be deleted",
    { ok: false, error_code: 400, description: "Bad Request: message can't be deleted" },
    "deleteMessage",
    {},
  );
  assert.deepEqual(classifyDeleteError(cannot), {
    action: "unavailable",
    reason: "cannot_delete",
  });
});

test("resolveDeleteTarget uses delivery bot and legacy ids", () => {
  const ok = resolveDeleteTarget({
    delivery: {
      status: "SENT",
      botId: "bot-1",
      telegramMessageId: BigInt(99),
      recipientTelegramChatId: BigInt(-100),
      bot: { tokenEncrypted: "enc" },
    },
    message: { telegramMessageId: BigInt(42) },
  });
  assert.ok(!("error" in ok));
  assert.equal(ok.chatId, -100);
  assert.equal(ok.messageId, 42);
});

test("executeBroadcastMessageDelete calls deleteMessage and sets DELETED", async () => {
  let deleted = false;
  const prisma = {
    broadcastDeliveryMessage: {
      updateMany: async () => ({ count: 1 }),
      findUnique: async () => ({
        id: "msg-1",
        deleteAttempts: 1,
        telegramMessageId: BigInt(7),
        delivery: {
          status: "SENT",
          botId: "b1",
          telegramMessageId: BigInt(7),
          recipientTelegramChatId: BigInt(-1001),
          bot: { tokenEncrypted: ENCRYPTED_TOKEN },
        },
      }),
      update: async (args: { data: { deleteStatus: string } }) => {
        if (args.data.deleteStatus === "DELETED") {
          deleted = true;
        }
      },
    },
  } as unknown as PrismaClient;

  const apiFactory = () =>
    ({
      deleteMessage: async () => true,
    }) as Api;

  const outcome = await executeBroadcastMessageDelete({
    prisma,
    encryptionKey: TEST_KEY,
    messageRowId: "msg-1",
    apiFactory,
    now: new Date("2026-10-11T12:00:00Z"),
  });
  assert.equal(outcome, "done");
  assert.equal(deleted, true);
});

test("executeBroadcastMessageDelete retries on rate limit", async () => {
  let releasePending = false;
  const prisma = {
    broadcastDeliveryMessage: {
      updateMany: async () => ({ count: 1 }),
      findUnique: async () => ({
        id: "msg-1",
        deleteAttempts: 1,
        telegramMessageId: BigInt(7),
        delivery: {
          status: "SENT",
          botId: "b1",
          telegramMessageId: BigInt(7),
          recipientTelegramChatId: BigInt(-1001),
          bot: { tokenEncrypted: ENCRYPTED_TOKEN },
        },
      }),
      update: async () => {},
    },
  } as unknown as PrismaClient;
  Object.assign(prisma.broadcastDeliveryMessage, {
    updateMany: async (args: { data?: { deleteStatus?: string } }) => {
      if (args.data?.deleteStatus === "PENDING") {
        releasePending = true;
      }
      return { count: 1 };
    },
  });

  const apiFactory = () =>
    ({
      deleteMessage: async () => {
        throw new GrammyError(
          "Too Many Requests",
          { ok: false, error_code: 429, description: "Too Many Requests", parameters: { retry_after: 1 } },
          "deleteMessage",
          {},
        );
      },
    }) as Api;

  const outcome = await executeBroadcastMessageDelete({
    prisma,
    encryptionKey: TEST_KEY,
    messageRowId: "msg-1",
    apiFactory,
  });
  assert.equal(outcome, "retry");
  assert.equal(releasePending, true);
});
