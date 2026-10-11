import type { FastifyRequest } from "fastify";
import type { BroadcastContentKind } from "@prisma/client";

const DECLARED_MEDIA_KINDS = new Set<BroadcastContentKind>([
  "PHOTO",
  "VIDEO",
  "AUDIO",
  "VOICE",
  "DOCUMENT",
  "ANIMATION",
]);

export type BroadcastMediaUploadErrorCode =
  | "broadcast_media_not_multipart"
  | "broadcast_media_missing_file"
  | "broadcast_media_missing_content_kind"
  | "broadcast_media_invalid_content_kind"
  | "broadcast_media_read_failed";

export type ParsedBroadcastMediaUpload =
  | {
      ok: true;
      declaredKind: BroadcastContentKind;
      buffer: Buffer;
      filename: string;
      mimetype: string;
    }
  | { ok: false; code: BroadcastMediaUploadErrorCode };

function contentKindFromQuery(request: FastifyRequest): string {
  const query = request.query;
  if (!query || typeof query !== "object") {
    return "";
  }
  const raw = (query as Record<string, unknown>).contentKind;
  return typeof raw === "string" ? raw.trim() : "";
}

export async function parseBroadcastMediaUpload(
  request: FastifyRequest,
): Promise<ParsedBroadcastMediaUpload> {
  if (!request.isMultipart()) {
    return { ok: false, code: "broadcast_media_not_multipart" };
  }

  let contentKindRaw = contentKindFromQuery(request);
  let fileBuffer: Buffer | null = null;
  let filename = "upload";
  let mimetype = "application/octet-stream";

  try {
    for await (const part of request.parts()) {
      if (part.type === "file") {
        if (part.fieldname === "file") {
          filename = part.filename || filename;
          mimetype = part.mimetype || mimetype;
          fileBuffer = await part.toBuffer();
        } else {
          await part.toBuffer();
        }
      } else if (part.fieldname === "contentKind") {
        contentKindRaw = String(part.value).trim();
      }
    }
  } catch {
    return { ok: false, code: "broadcast_media_read_failed" };
  }

  if (!fileBuffer || fileBuffer.length === 0) {
    return { ok: false, code: "broadcast_media_missing_file" };
  }
  if (!contentKindRaw) {
    return { ok: false, code: "broadcast_media_missing_content_kind" };
  }
  if (!DECLARED_MEDIA_KINDS.has(contentKindRaw as BroadcastContentKind)) {
    return { ok: false, code: "broadcast_media_invalid_content_kind" };
  }

  return {
    ok: true,
    declaredKind: contentKindRaw as BroadcastContentKind,
    buffer: fileBuffer,
    filename,
    mimetype,
  };
}
