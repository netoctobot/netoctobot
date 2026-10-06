import assert from "node:assert/strict";
import test from "node:test";
import { type PrismaClient, SupportedLanguage } from "@prisma/client";
import { getWebLocale, setWebLocale } from "./web-locale.js";

test("web locale is stored apart from Telegram bot preferences", async () => {
  const rows = new Map<string, SupportedLanguage>();
  const prisma = {
    webLocalePreference: {
      async findUnique({ where }: { where: { userId: string } }) {
        const language = rows.get(where.userId);
        return language ? { language, isExplicit: true, userId: where.userId } : null;
      },
      async upsert({
        where,
        create,
      }: {
        where: { userId: string };
        create: { language: SupportedLanguage };
        update: { language: SupportedLanguage };
      }) {
        rows.set(where.userId, create.language);
        return { language: create.language, isExplicit: true, userId: where.userId };
      },
    },
    userBotPreference: new Proxy(
      {},
      {
        get() {
          return () => {
            throw new Error("bot preference touched");
          };
        },
      },
    ),
  } as unknown as PrismaClient;

  assert.equal(await getWebLocale(prisma, "owner"), null);
  assert.equal(
    await setWebLocale(prisma, "owner", SupportedLanguage.AR),
    SupportedLanguage.AR,
  );
  assert.equal(await getWebLocale(prisma, "owner"), SupportedLanguage.AR);
});
