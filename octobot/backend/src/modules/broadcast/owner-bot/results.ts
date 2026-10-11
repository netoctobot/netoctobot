import type { PrismaClient } from "@prisma/client";

export async function summarizeCampaignCounts(
  prisma: PrismaClient,
  campaignId: string,
): Promise<string> {
  const rows = await prisma.broadcastDelivery.groupBy({
    by: ["status"],
    where: { campaignId },
    _count: { _all: true },
  });
  return rows.map((row) => `${row.status}: ${row._count._all}`).join("\n");
}
