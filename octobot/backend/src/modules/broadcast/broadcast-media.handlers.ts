import { writeFile } from "node:fs/promises";
import type { FastifyInstance } from "fastify";
import type { PrismaClient } from "@prisma/client";
import { PRODUCT_LIMITS } from "./content.js";
import {
  detectContentKindFromBuffer,
  kindMatchesDetection,
} from "./content.js";
import {
  absolutePathForKey,
  deleteMediaFile,
  ensureMediaRoot,
  generateStorageKey,
  hashStorageKey,
  inlineContentType,
  openMediaReadStream,
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
    const file = await request.file();
    if (!file) {
      return reply.code(400).send({ error: "invalid_broadcast_media" });
    }
    const kindField = file.fields.contentKind;
    const kindValue =
      kindField && typeof kindField === "object" && "value" in kindField
        ? String(kindField.value)
        : "";
    if (
      kindValue !== "PHOTO" &&
      kindValue !== "VIDEO" &&
      kindValue !== "AUDIO" &&
      kindValue !== "VOICE" &&
      kindValue !== "DOCUMENT" &&
      kindValue !== "ANIMATION"
    ) {
      return reply.code(400).send({ error: "invalid_broadcast_media" });
    }
    const declaredKind = kindValue as
      | "PHOTO"
      | "VIDEO"
      | "AUDIO"
      | "VOICE"
      | "DOCUMENT"
      | "ANIMATION";
    const maxBytes = uploadByteLimit(declaredKind);
    const buffers: Buffer[] = [];
    let total = 0;
    try {
      for await (const chunk of file.file) {
        const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        total += buf.length;
        if (total > maxBytes) {
          return reply.code(400).send({ error: "media_too_large" });
        }
        buffers.push(buf);
      }
    } catch {
      return reply.code(400).send({ error: "invalid_broadcast_media" });
    }
    const body = Buffer.concat(buffers);
    const headBuffer = body.subarray(0, Math.min(512, body.length));
    const detectedKind = detectContentKindFromBuffer(headBuffer);
    if (!detectedKind || !kindMatchesDetection(declaredKind, detectedKind)) {
      return reply.code(400).send({ error: "media_type_mismatch" });
    }
    const storageKey = generateStorageKey();
    const tempPath = `${absolutePathForKey(input.mediaRoot, storageKey)}.partial`;
    const finalPath = absolutePathForKey(input.mediaRoot, storageKey);
    try {
      await ensureMediaRoot(input.mediaRoot);
      await writeFile(tempPath, body);
      const { rename } = await import("node:fs/promises");
      await rename(tempPath, finalPath);
    } catch {
      await deleteMediaFile(input.mediaRoot, storageKey).catch(() => undefined);
      return reply.code(400).send({ error: "invalid_broadcast_media" });
    }
    const expiresAt = new Date(Date.now() + PRODUCT_LIMITS.orphanUploadTtlHours * 60 * 60 * 1000);
    const sha256 = await hashStorageKey(input.mediaRoot, storageKey);
    const row = await input.prisma.broadcastMediaAsset.create({
      data: {
        uploadedByAdmin: admin.username,
        originalName: file.filename.slice(0, 255),
        storageKey,
        mimeTypeReported: file.mimetype,
        detectedMime: null,
        contentKind: detectedKind,
        sizeBytes: BigInt(body.length),
        expiresAt,
      },
    });
    return {
      mediaUploadId: row.id,
      contentKind: row.contentKind,
      sizeBytes: body.length,
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
