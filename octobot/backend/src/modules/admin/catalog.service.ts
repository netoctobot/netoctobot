import type { Prisma, PrismaClient } from "@prisma/client";

export async function setCatalogActive(
  prisma: PrismaClient,
  adminUsername: string,
  id: string,
  isActive: boolean,
  ip: string | undefined,
): Promise<{ id: string; isActive: boolean } | null> {
  const existing = await prisma.platformForcedChannel.findUnique({
    where: { id },
    select: { id: true },
  });
  if (!existing) {
    return null;
  }
  const updated = await prisma.platformForcedChannel.update({
    where: { id },
    data: { isActive },
    select: { id: true, isActive: true },
  });
  await prisma.auditLog.create({
    data: {
      action: "catalog.set_active",
      entityType: "PlatformForcedChannel",
      entityId: id,
      details: { isActive, adminUsername },
      ip,
    },
  });
  return updated;
}

export async function reorderCatalog(
  prisma: PrismaClient,
  adminUsername: string,
  ids: string[],
  ip: string | undefined,
): Promise<boolean> {
  const existing = await prisma.platformForcedChannel.findMany({
    select: { id: true },
  });
  const unique = new Set(ids);
  if (
    unique.size !== ids.length ||
    existing.length !== ids.length ||
    existing.some((row) => !unique.has(row.id))
  ) {
    return false;
  }
  const updates: Prisma.PrismaPromise<unknown>[] = ids.map((id, index) =>
    prisma.platformForcedChannel.update({
      where: { id },
      data: { sortOrder: index },
    }),
  );
  await prisma.$transaction(updates);
  await prisma.auditLog.create({
    data: {
      action: "catalog.reorder",
      entityType: "PlatformForcedChannel",
      entityId: ids[0] ?? null,
      details: { ids, adminUsername },
      ip,
    },
  });
  return true;
}
