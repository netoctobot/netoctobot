import { type PrismaClient, type SupportedLanguage } from "@prisma/client";

export async function getWebLocale(
  prisma: PrismaClient,
  userId: string,
): Promise<SupportedLanguage | null> {
  const preference = await prisma.webLocalePreference.findUnique({
    where: { userId },
  });
  return preference?.language ?? null;
}

export async function setWebLocale(
  prisma: PrismaClient,
  userId: string,
  language: SupportedLanguage,
): Promise<SupportedLanguage> {
  const preference = await prisma.webLocalePreference.upsert({
    where: { userId },
    create: {
      userId,
      language,
      isExplicit: true,
    },
    update: {
      language,
      isExplicit: true,
    },
  });
  return preference.language;
}
