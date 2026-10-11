import assert from "node:assert/strict";
import test from "node:test";
import type { PrismaClient } from "@prisma/client";
import { summarizeMessageDeletes } from "./delete-summary.js";
import { findMessagesNeedingDeleteQueue } from "./delete-reconcile.js";

test("summarizeMessageDeletes counts terminal and in-flight states", () => {
  const summary = summarizeMessageDeletes(
    [
      { deleteStatus: "DELETED", deleteReason: null },
      { deleteStatus: "GONE", deleteReason: "message_not_found" },
      { deleteStatus: "UNAVAILABLE", deleteReason: "cannot_delete" },
      { deleteStatus: "PENDING", deleteReason: null },
      { deleteStatus: "NONE", deleteReason: null },
    ],
    true,
  );
  assert.equal(summary.deleted, 1);
  assert.equal(summary.gone, 1);
  assert.equal(summary.unavailable, 1);
  assert.equal(summary.pending, 1);
  assert.equal(summary.none, 1);
  assert.equal(summary.unavailableReasons.cannot_delete, 1);
  assert.equal(summary.active, true);
});

test("findMessagesNeedingDeleteQueue promotes NONE rows for sent deliveries", async () => {
  const pendingIds: string[] = [];
  const prisma = {
    broadcastDeliveryMessage: {
      findMany: async () => [{ id: "a", deleteStatus: "NONE" }],
      updateMany: async () => {
        pendingIds.push("a");
        return { count: 1 };
      },
    },
  } as unknown as PrismaClient;

  const ids = await findMessagesNeedingDeleteQueue(prisma);
  assert.deepEqual(ids, ["a"]);
  assert.equal(pendingIds.length, 1);
});
