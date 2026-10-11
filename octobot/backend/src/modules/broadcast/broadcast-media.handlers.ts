import { writeFile } from "node:fs/promises";
import type { FastifyInstance } from "fastify";
import type { PrismaClient } from "@prisma/client";
import { PRODUCT_LIMITS } from "./content.js";
import {
  detectContentKindFromBuffer,
  kindMatchesDetection,
} from "./content.js";
import { parseBroadcastMediaUpload } from "./broadcast-media-upload.js";
import {
  absolutePathForKey,
  deleteMediaFile,
  ensureMediaRoot,
  generateStorageKey,
  hashStorageKey,
  inlineContentType,
  openMediaReadStream,
  sanitizeBroadcastFilename,
  uploadByteLimit,
} from "./media-storage.js";

export function registerBroadcastMediaRoutes(
  app: FastifyInstance,
  input: {
    prisma: PrismaClient;
    mediaRoot: string;
    requireAdmin: (
      request: { headers: { cookie?: string | string[] }; ip: string },
      reply: { code: (status: number) => { send: (body: unknown) => unknown } },
    ) => Promise<{ username: string } | null>;
  },
): void {
  app.post("/admin/broadcasts/media", async (request, reply) => {
    const admin = await input.requireAdmin(request, reply);
    if (!admin) {
      return;
    }
    const parsed = await parseBroadcastMediaUpload(request);
    if (!parsed.ok) {
      return reply.code(400).send({ error: parsed.code });
    }
    const maxBytes = uploadByteLimit(parsed.declaredKind);
    if (parsed.buffer.length > maxBytes) {
      return reply.code(400).send({ error: "media_too_large" });
    }
    const headBuffer = parsed.buffer.subarray(0, Math.min(512, parsed.buffer.length));
    const detectedKind = detectContentKindFromBuffer(headBuffer);
    if (!detectedKind || !kindMatchesDetection(parsed.declaredKind, detectedKind)) {
      return reply.code(400).send({ error: "media_type_mismatch" });
    }
    const storageKey = generateStorageKey();
    const tempPath = `${absolutePathForKey(input.mediaRoot, storageKey)}.partial`;
    const finalPath = absolutePathForKey(input.mediaRoot, storageKey);
    try {
      await ensureMediaRoot(input.mediaRoot);
      await writeFile(tempPath, parsed.buffer);
      const { rename } = await import("node:fs/promises");
      await rename(tempPath, finalPath);
    } catch {
      await deleteMediaFile(input.mediaRoot, storageKey).catch(() => undefined);
      return reply.code(400).send({ error: "broadcast_media_storage_failed" });
    }
    const expiresAt = new Date(Date.now() + PRODUCT_LIMITS.orphanUploadTtlHours * 60 * 60 * 1000);
    const sha256 = await hashStorageKey(input.mediaRoot, storageKey);
    const row = await input.prisma.broadcastMediaAsset.create({
      data: {
        uploadedByAdmin: admin.username,
        originalName: sanitizeBroadcastFilename(parsed.filename),
        storageKey,
        mimeTypeReported: parsed.mimetype,
        detectedMime: null,
        contentKind: detectedKind,
        sizeBytes: BigInt(parsed.buffer.length),
        expiresAt,
      },
    });
    return {
      mediaUploadId: row.id,
      contentKind: row.contentKind,
      sizeBytes: parsed.buffer.length,
      originalName: row.originalName,
      sha256,
    };
  });

  app.delete<{ Params: { id: string } }>("/admin/broadcasts/media/:id", async (request, reply) => {
    const admin = await input.requireAdmin(request, reply);
    if (!admin) {
      return;
    }
    const id = request.params.id;
    const asset = await input.prisma.broadcastMediaAsset.findUnique({
      where: { id },
      include: { campaign: { select: { id: true } } },
    });
    if (!asset) {
      return reply.code(404).send({ error: "not_found" });
    }
    if (asset.campaign) {
      return reply.code(409).send({ error: "media_linked_to_campaign" });
    }
    if (!asset.fileDeletedAt) {
      await deleteMediaFile(input.mediaRoot, asset.storageKey).catch(() => undefined);
      await input.prisma.broadcastMediaAsset.update({
        where: { id },
        data: { fileDeletedAt: new Date() },
      });
    }
    return { id, deleted: true };
  });

  app.get<{ Params: { id: string } }>(
    "/admin/broadcasts/media/:id/content",
    async (request, reply) => {
      const admin = await input.requireAdmin(request, reply);
      if (!admin) {
        return;
      }
      const id = request.params.id;
      const asset = await input.prisma.broadcastMediaAsset.findUnique({
        where: { id },
        select: {
          storageKey: true,
          contentKind: true,
          detectedMime: true,
          mimeTypeReported: true,
          fileDeletedAt: true,
          originalName: true,
        },
      });
      if (!asset || asset.fileDeletedAt) {
        return reply.code(404).send({ error: "not_found" });
      }
      const type = inlineContentType(asset.contentKind, asset.detectedMime ?? asset.mimeTypeReported);
      reply.header("Content-Type", type);
      reply.header("Content-Disposition", `inline; filename="${asset.originalName.replace(/"/g, "")}"`);
      return reply.send(openMediaReadStream(input.mediaRoot, asset.storageKey));
    },
  );
}
