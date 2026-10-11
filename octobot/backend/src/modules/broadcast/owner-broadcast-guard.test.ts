import assert from "node:assert/strict";
import test from "node:test";
import type { PrismaClient } from "@prisma/client";
import {
  assertOwnerBotAccess,
  buildOwnerBroadcastRequest,
  OwnerBroadcastAccessError,
} from "./owner-broadcast-guard.js";

test("assertOwnerBotAccess rejects non-owner", async () => {
  const prisma = {
    user: { findUnique: async () => ({ id: "u1" }) },
    bot: {
      findUnique: async () => ({
        id: "b1",
        ownerId: "other",
        isActive: true,
        deletedAt: null,
      }),
    },
  } as unknown as PrismaClient;
  await assert.rejects(
    () => assertOwnerBotAccess(prisma, "b1", 100),
    (error: unknown) => error instanceof OwnerBroadcastAccessError && error.code === "bot_not_owned",
  );
});

test("buildOwnerBroadcastRequest scopes to one bot", () => {
  const request = buildOwnerBroadcastRequest("bot-1", "both", {
    text: "hi",
    contentKind: "TEXT",
    caption: null,
    linkButtons: null,
    mediaUploadId: null,
  });
  assert.deepEqual(request.botIds, ["bot-1"]);
  assert.equal(request.audienceType, "CHANNELS_AND_USERS");
  assert.equal(request.includeBotOwners, false);
});
