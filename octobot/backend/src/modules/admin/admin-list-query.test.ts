import assert from "node:assert/strict";
import test from "node:test";
import { BotType } from "@prisma/client";
import {
  adminListQuery,
  botListWhere,
  channelListWhere,
  userListWhere,
} from "./admin-read.service.js";

test("reads optional list filters and ignores unknown values", () => {
  assert.deepEqual(
    adminListQuery(
      {
        q: "  Octo  ",
        status: "active",
        type: "CONTACT_BOT",
        catalog: "yes",
        ignored: "no",
      },
      2,
    ),
    {
      page: 2,
      q: "Octo",
      status: "active",
      type: BotType.CONTACT_BOT,
      catalog: "yes",
    },
  );
  assert.deepEqual(adminListQuery({ status: "paused", type: "OTHER" }, 1), {
    page: 1,
  });
});

test("user search matches names and a telegram id without an inactive state", () => {
  assert.deepEqual(userListWhere({ page: 1, status: "inactive", q: "42" }), {
    OR: [
      { username: { contains: "42", mode: "insensitive" } },
      { firstName: { contains: "42", mode: "insensitive" } },
      { lastName: { contains: "42", mode: "insensitive" } },
      { id: "42" },
      { telegramId: 42n },
    ],
  });
  assert.deepEqual(userListWhere({ page: 1, status: "deleted" }).deletedAt, {
    not: null,
  });
});

test("bot and channel filters stay on stored fields", () => {
  assert.deepEqual(botListWhere({ page: 1, status: "inactive", type: BotType.SUPPORT_LIST_BOT }), {
    isActive: false,
    deletedAt: null,
    botType: BotType.SUPPORT_LIST_BOT,
  });
  assert.deepEqual(channelListWhere({ page: 1, status: "active", catalog: "no", q: "news" }), {
    isActive: true,
    deletedAt: null,
    isPlatformCatalog: false,
    OR: [
      { title: { contains: "news", mode: "insensitive" } },
      { username: { contains: "news", mode: "insensitive" } },
      { id: "news" },
    ],
  });
});
