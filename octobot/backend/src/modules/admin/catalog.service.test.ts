import assert from "node:assert/strict";
import test from "node:test";
import type { PrismaClient } from "@prisma/client";
import { reorderCatalog, setCatalogActive } from "./catalog.service.js";

test("catalog changes do not copy channels into forced subscriptions", async () => {
  const rows = [
    { id: "a", isActive: true, sortOrder: 0 },
    { id: "b", isActive: false, sortOrder: 1 },
  ];
  const touched: string[] = [];
  const prisma = {
    platformForcedChannel: {
      async findMany() {
        return rows.map((row) => ({ id: row.id }));
      },
      async findUnique({ where }: { where: { id: string } }) {
        return rows.find((row) => row.id === where.id) ?? null;
      },
      async update({
        where,
        data,
      }: {
        where: { id: string };
        data: { isActive?: boolean; sortOrder?: number };
      }) {
        const row = rows.find((item) => item.id === where.id);
        if (!row) {
          throw new Error("missing");
        }
        Object.assign(row, data);
        return row;
      },
    },
    forcedSubscription: new Proxy(
      {},
      {
        get() {
          return () => {
            touched.push("forced");
            throw new Error("forced subscription touched");
          };
        },
      },
    ),
    auditLog: {
      async create() {
        return { id: "audit" };
      },
    },
    async $transaction(operations: Array<Promise<unknown>>) {
      return Promise.all(operations);
    },
  } as unknown as PrismaClient;

  const updated = await setCatalogActive(prisma, "owner", "a", false, "127.0.0.1");
  assert.equal(updated?.id, "a");
  assert.equal(updated?.isActive, false);
  assert.equal(await reorderCatalog(prisma, "owner", ["b", "a"], "127.0.0.1"), true);
  assert.deepEqual(
    rows.map((row) => row.sortOrder),
    [1, 0],
  );
  assert.deepEqual(touched, []);
  assert.equal(await reorderCatalog(prisma, "owner", ["a"], "127.0.0.1"), false);
});
