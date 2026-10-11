import assert from "node:assert/strict";
import test from "node:test";
import type { PrismaClient } from "@prisma/client";
import {
  claimMessageForDelete,
  markMessageDeletePending,
  recoverExpiredDeleteClaims,
} from "./delete-claim.js";

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

test("recoverExpiredDeleteClaims moves stale IN_PROGRESS back to PENDING", async () => {
  let data: { deleteStatus?: string; deleteLeaseExpiresAt?: null } | undefined;
  const prisma = {
    broadcastDeliveryMessage: {
      updateMany: async (args: {
        where: { deleteStatus: string; deleteLeaseExpiresAt: { lt: Date } };
        data: { deleteStatus: string; deleteLeaseExpiresAt: null };
      }) => {
        assert.equal(args.where.deleteStatus, "IN_PROGRESS");
        data = args.data;
        return { count: 2 };
      },
    },
  } as unknown as PrismaClient;

  const count = await recoverExpiredDeleteClaims(
    prisma,
    new Date("2026-10-11T12:00:00Z"),
  );
  assert.equal(count, 2);
  assert.equal(data?.deleteStatus, "PENDING");
  assert.equal(data?.deleteLeaseExpiresAt, null);
});

test("claimMessageForDelete reclaims IN_PROGRESS when lease expired", async () => {
  const captured: unknown[] = [];
  const prisma = {
    broadcastDeliveryMessage: {
      updateMany: async (args: unknown) => {
        captured.push(args);
        return { count: 1 };
      },
    },
  } as unknown as PrismaClient;

  const now = new Date("2026-10-11T12:00:00Z");
  const ok = await claimMessageForDelete(prisma, "m1", now);
  assert.equal(ok, true);
  const where = (captured[0] as { where: { OR: Array<{ deleteStatus: string }> } }).where;
  assert.ok(
    where.OR.some(
      (clause) =>
        clause.deleteStatus === "IN_PROGRESS" ||
        ("deleteLeaseExpiresAt" in clause && clause.deleteStatus === "IN_PROGRESS"),
    ),
  );
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
