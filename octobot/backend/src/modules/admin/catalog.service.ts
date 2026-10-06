import type { Prisma, PrismaClient } from "@prisma/client";

export async function setCatalogActive(
  prisma: PrismaClient,
  actorId: string,
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
      userId: actorId,
      action: "catalog.set_active",
      entityType: "PlatformForcedChannel",
      entityId: id,
      details: { isActive },
      ip,
    },
  });
  return updated;
}

export async function reorderCatalog(
  prisma: PrismaClient,
  actorId: string,
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
      userId: actorId,
      action: "catalog.reorder",
      entityType: "PlatformForcedChannel",
      entityId: ids[0] ?? null,
      details: { ids },
      ip,
    },
  });
  return true;
}
