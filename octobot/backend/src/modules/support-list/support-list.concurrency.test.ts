import assert from "node:assert/strict";
import test from "node:test";
import { PrismaClient } from "@prisma/client";
import { MAX_ACCEPTED_CHANNELS } from "./constants.js";
import { acceptMembership } from "./membership.service.js";

const databaseUrl = process.env.SUPPORT_LIST_TEST_DATABASE_URL;

test(
  "two accepts cannot both take the last slot",
  { skip: databaseUrl ? false : "isolated PostgreSQL URL is not set" },
  async () => {
    const prisma = new PrismaClient({
      datasources: { db: { url: databaseUrl } },
    });
    const stamp = BigInt(Date.now());
    const user = await prisma.user.create({
      data: { telegramId: stamp },
    });
    try {
      const bot = await prisma.bot.create({
        data: {
          ownerId: user.id,
          telegramBotId: stamp,
          tokenEncrypted: "test",
          botUsername: `list_${stamp}`,
          botType: "SUPPORT_LIST_BOT",
          welcomeMessages: {},
          footerTexts: {},
        },
      });
      const settings = await prisma.supportListSettings.create({
        data: { botId: bot.id, acceptanceMode: "MANUAL" },
      });
      for (let index = 0; index < MAX_ACCEPTED_CHANNELS + 1; index += 1) {
        const channel = await prisma.channel.create({
          data: {
            ownerId: user.id,
            telegramOwnerId: stamp,
            channelTelegramId: stamp * 1000n + BigInt(index + 1),
            title: `channel ${index}`,
          },
        });
        await prisma.supportListMembership.create({
          data: {
            settingsId: settings.id,
            botId: bot.id,
            channelId: channel.id,
            channelTelegramId: channel.channelTelegramId,
            addedByUserId: user.id,
            acceptanceStatus:
              index < MAX_ACCEPTED_CHANNELS - 1 ? "ACCEPTED" : "PENDING",
          },
        });
      }
      const pending = await prisma.supportListMembership.findMany({
        where: { botId: bot.id, acceptanceStatus: "PENDING" },
        select: { id: true },
      });
      assert.equal(pending.length, 2);
      const results = await Promise.all(
        pending.map((membership) =>
          acceptMembership(prisma, bot.id, membership.id),
        ),
      );
      assert.deepEqual(results.sort(), ["accepted", "full"]);
      const accepted = await prisma.supportListMembership.count({
        where: {
          botId: bot.id,
          acceptanceStatus: "ACCEPTED",
          deletedAt: null,
        },
      });
      assert.equal(accepted, MAX_ACCEPTED_CHANNELS);
    } finally {
      await prisma.supportListMembership.deleteMany({
        where: { addedByUserId: user.id },
      });
      await prisma.supportListSettings.deleteMany({
        where: { bot: { ownerId: user.id } },
      });
      await prisma.channel.deleteMany({ where: { ownerId: user.id } });
      await prisma.bot.deleteMany({ where: { ownerId: user.id } });
      await prisma.user.delete({ where: { id: user.id } });
      await prisma.$disconnect();
    }
  },
);
