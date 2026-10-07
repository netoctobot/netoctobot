import assert from "node:assert/strict";
import test from "node:test";
import type { PrismaClient } from "@prisma/client";
import type { Env } from "../../config/env.js";
import { bootstrapLocalDashboardAdmin } from "./bootstrap-admin.js";
import { verifyPassword } from "./password.js";

const password = "local-password";

function env(overrides: Partial<Env> = {}): Env {
  return {
    NODE_ENV: "development",
    LOCAL_ADMIN_USERNAME: "localadmin",
    LOCAL_ADMIN_PASSWORD: password,
    ...overrides,
  } as Env;
}

test("creates the local admin once and does not reset the password", async () => {
  let row: { id: string; username: string; passwordHash: string } | null = null;
  const prisma = {
    dashboardAdmin: {
      async findFirst() {
        return row ? { id: row.id } : null;
      },
      async create({
        data,
      }: {
        data: { username: string; passwordHash: string };
      }) {
        row = { id: "admin_1", ...data };
        return row;
      },
    },
  } as unknown as PrismaClient;

  await bootstrapLocalDashboardAdmin(prisma, env());
  const createdHash = row?.passwordHash;
  assert.equal(row?.username, "localadmin");
  assert.equal(createdHash?.includes(password), false);
  assert.equal(await verifyPassword(password, createdHash ?? null), true);

  await bootstrapLocalDashboardAdmin(
    prisma,
    env({ LOCAL_ADMIN_PASSWORD: "replacement-password" }),
  );
  assert.equal(row?.passwordHash, createdHash);
});

test("does not create an admin in production", async () => {
  let created = false;
  const logs: string[] = [];
  const prisma = {
    dashboardAdmin: {
      async findFirst() {
        return null;
      },
      async create() {
        created = true;
        return { id: "admin_1" };
      },
    },
  } as unknown as PrismaClient;

  await bootstrapLocalDashboardAdmin(
    prisma,
    env({ NODE_ENV: "production" }),
    (message) => logs.push(message),
  );
  assert.equal(created, false);
  assert.equal(logs.length, 1);
  assert.equal(logs.join(" ").includes(password), false);
});

test("skips bootstrap when local credentials are omitted", async () => {
  let created = false;
  const prisma = {
    dashboardAdmin: {
      async create() {
        created = true;
      },
    },
  } as unknown as PrismaClient;
  await bootstrapLocalDashboardAdmin(
    prisma,
    env({
      LOCAL_ADMIN_USERNAME: undefined,
      LOCAL_ADMIN_PASSWORD: undefined,
    }),
  );
  assert.equal(created, false);
});
