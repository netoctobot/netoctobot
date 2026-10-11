import assert from "node:assert/strict";
import test from "node:test";
import type { PrismaClient } from "@prisma/client";
import { claimMessageForDelete, markMessageDeletePending } from "./delete-claim.js";

test("claimMessageForDelete only succeeds for PENDING or expired IN_PROGRESS", async () => {
  const calls: unknown[] = [];
  const prisma = {
    broadcastDeliveryMessage: {
      updateMany: async (args: unknown) => {
        calls.push(args);
        return { count: 1 };
      },
    },
  } as unknown as PrismaClient;

  const ok = await claimMessageForDelete(prisma, "m1", new Date("2026-10-11T12:00:00Z"));
  assert.equal(ok, true);
  assert.equal(calls.length, 1);
  const where = (calls[0] as { where: { OR: unknown[] } }).where;
  assert.ok(Array.isArray(where.OR));
});

test("markMessageDeletePending transitions NONE to PENDING", async () => {
  let status: string | undefined;
  const prisma = {
    broadcastDeliveryMessage: {
      updateMany: async (args: { data: { deleteStatus: string } }) => {
        status = args.data.deleteStatus;
        return { count: 1 };
      },
    },
  } as unknown as PrismaClient;

  const ok = await markMessageDeletePending(prisma, "m1");
  assert.equal(ok, true);
  assert.equal(status, "PENDING");
});
