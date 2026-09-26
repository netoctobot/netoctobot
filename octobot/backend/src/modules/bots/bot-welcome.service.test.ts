import assert from "node:assert/strict";
import test from "node:test";
import {
  BotType,
  SupportedLanguage,
  type Bot,
  type PrismaClient,
} from "@prisma/client";
import {
  defaultWelcomeMessages,
  resetWelcomeMessage,
  resolveWelcomeMessage,
  setWelcomeMessage,
} from "./bot-welcome.service.js";

function record(messages: Record<string, string>): Bot {
  return {
    id: "bot-id",
    botType: BotType.CONTACT_BOT,
    welcomeMessages: messages,
  } as Bot;
}

test("resolves requested welcome language with a default fallback", () => {
  assert.equal(
    resolveWelcomeMessage(
      record({ ar: "أهلاً", en: "Welcome" }),
      SupportedLanguage.AR,
    ),
    "أهلاً",
  );
  assert.equal(
    resolveWelcomeMessage(
      record({ en: "Welcome" }),
      SupportedLanguage.AR,
    ),
    "Welcome",
  );
  assert.match(
    defaultWelcomeMessages(BotType.CONTACT_BOT).ar,
    /رسالتك/,
  );
});

test("updates and resets one language without changing others", async () => {
  let current = record({ ar: "قديم", en: "Keep English" });
  const prisma = {
    bot: {
      findUniqueOrThrow: async () => current,
      update: async (input: {
        data: { welcomeMessages: Record<string, string> };
      }) => {
        current = {
          ...current,
          welcomeMessages: input.data.welcomeMessages,
        };
        return current;
      },
    },
  } as unknown as PrismaClient;

  await setWelcomeMessage(
    prisma,
    current.id,
    SupportedLanguage.AR,
    "جديد",
  );
  assert.deepEqual(current.welcomeMessages, {
    ar: "جديد",
    en: "Keep English",
  });

  await resetWelcomeMessage(
    prisma,
    current.id,
    SupportedLanguage.AR,
  );
  assert.equal(
    (current.welcomeMessages as Record<string, string>).en,
    "Keep English",
  );
  assert.equal(
    (current.welcomeMessages as Record<string, string>).ar,
    defaultWelcomeMessages(BotType.CONTACT_BOT).ar,
  );
});
