import assert from "node:assert/strict";
import test from "node:test";
import {
  LinkStatus,
  type PrismaClient,
} from "@prisma/client";
import {
  ManagedResourceNotFoundError,
  setOwnedChannelActive,
  softDeleteOwnedChannel,
} from "./channel-management.service.js";

function prisma(input: { updatedCount?: number } = {}) {
  const channelUpdates: unknown[] = [];
  const linkUpdates: unknown[] = [];
  const auditEntries: unknown[] = [];
  const transaction = {
    channel: {
      updateMany: async (value: unknown) => {
        channelUpdates.push(value);
        return { count: input.updatedCount ?? 1 };
      },
    },
    botChannelLink: {
      updateMany: async (value: unknown) => {
        linkUpdates.push(value);
        return { count: 2 };
      },
    },
    auditLog: {
      create: async (value: unknown) => {
        auditEntries.push(value);
        return {};
      },
    },
  };
  return {
    client: {
      $transaction: async (
        callback: (value: typeof transaction) => unknown,
      ) => callback(transaction),
    } as unknown as PrismaClient,
    channelUpdates,
    linkUpdates,
    auditEntries,
  };
}

test("scopes channel deactivation to the current owner", async () => {
  const database = prisma();

  await setOwnedChannelActive(database.client, {
    ownerId: "owner",
    channelId: "channel",
    isActive: false,
  });

  assert.deepEqual(database.channelUpdates[0], {
    where: {
      id: "channel",
      ownerId: "owner",
      deletedAt: null,
      isPlatformCatalog: false,
    },
    data: {
      isActive: false,
      deactivationReason: "OWNER_PAUSED",
    },
  });
  assert.equal(database.auditEntries.length, 1);
});

test("soft deletion preserves the channel row and inactivates every link", async () => {
  const database = prisma();

  await softDeleteOwnedChannel(database.client, {
    ownerId: "owner",
    channelId: "channel",
  });

  const channelUpdate = database.channelUpdates[0] as {
    data: {
      isActive: boolean;
      deletedAt: Date;
      deactivationReason: string;
    };
  };
  assert.equal(channelUpdate.data.isActive, false);
  assert.ok(channelUpdate.data.deletedAt instanceof Date);
  assert.equal(
    channelUpdate.data.deactivationReason,
    "OWNER_REMOVED",
  );

  const linkUpdate = database.linkUpdates[0] as {
    where: { channelId: string };
    data: {
      status: LinkStatus;
      deactivationReason: string;
    };
  };
  assert.equal(linkUpdate.where.channelId, "channel");
  assert.equal(linkUpdate.data.status, LinkStatus.INACTIVE);
  assert.equal(
    linkUpdate.data.deactivationReason,
    "CHANNEL_DELETED",
  );
});

test("rejects stale or cross-owner channel actions", async () => {
  const database = prisma({ updatedCount: 0 });
  await assert.rejects(
    setOwnedChannelActive(database.client, {
      ownerId: "owner",
      channelId: "missing",
      isActive: true,
    }),
    ManagedResourceNotFoundError,
  );
});
