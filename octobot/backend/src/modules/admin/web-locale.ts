import { type PrismaClient, type SupportedLanguage } from "@prisma/client";

export async function getWebLocale(
  prisma: PrismaClient,
  adminId: string,
): Promise<SupportedLanguage | null> {
  const preference = await prisma.webLocalePreference.findUnique({
    where: { adminId },
  });
  return preference?.language ?? null;
}

export async function setWebLocale(
  prisma: PrismaClient,
  adminId: string,
  language: SupportedLanguage,
): Promise<SupportedLanguage> {
  const preference = await prisma.webLocalePreference.upsert({
    where: { adminId },
    create: {
      adminId,
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
