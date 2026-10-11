import { createHash, randomBytes } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, rm, stat, rename } from "node:fs/promises";
import path from "node:path";
import { finished } from "node:stream/promises";
import type { Readable } from "node:stream";
import type { BroadcastContentKind } from "@prisma/client";
import {
  detectContentKindFromBuffer,
  kindMatchesDetection,
  productMaxUploadBytes,
} from "./content.js";

export function resolveMediaRoot(dir: string): string {
  return path.resolve(dir);
}

export function generateStorageKey(): string {
  return randomBytes(16).toString("hex");
}

/** Safe client-facing filename for Telegram (basename only, no path segments). */
export function sanitizeBroadcastFilename(originalName: string): string {
  const base = originalName.replace(/\\/g, "/").split("/").pop() ?? "";
  const trimmed = base.trim().slice(0, 200);
  const sanitized = trimmed.replace(/[^\w.\- ()[\]]+/gu, "_");
  if (!sanitized || sanitized === "." || sanitized === "..") {
    return "upload.dat";
  }
  return sanitized;
}

export async function ensureMediaRoot(dir: string): Promise<void> {
  await mkdir(resolveMediaRoot(dir), { recursive: true });
}

export function absolutePathForKey(root: string, storageKey: string): string {
  const safe = storageKey.replace(/[^a-f0-9]/gi, "");
  if (safe !== storageKey) {
    throw new Error("Invalid storage key");
  }
  return path.join(resolveMediaRoot(root), safe);
}

export async function storeUploadStream(input: {
  root: string;
  storageKey: string;
  stream: Readable;
  maxBytes: number;
  declaredKind: BroadcastContentKind;
  headBuffer: Buffer;
}): Promise<{ sizeBytes: number; detectedKind: BroadcastContentKind }> {
  await ensureMediaRoot(input.root);
  const finalPath = absolutePathForKey(input.root, input.storageKey);
  const tempPath = `${finalPath}.partial`;
  const detectedKind = detectContentKindFromBuffer(input.headBuffer);
  if (!detectedKind || !kindMatchesDetection(input.declaredKind, detectedKind)) {
    await rm(tempPath, { force: true }).catch(() => undefined);
    throw new Error("media_type_mismatch");
  }
  let written = input.headBuffer.length;
  const out = createWriteStream(tempPath, { flags: "w" });
  try {
    if (!out.write(input.headBuffer)) {
      await finished(out);
    }
    for await (const chunk of input.stream) {
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      written += buf.length;
      if (written > input.maxBytes) {
        throw new Error("media_too_large");
      }
      if (!out.write(buf)) {
        await new Promise<void>((resolve, reject) => {
          out.once("drain", resolve);
          out.once("error", reject);
        });
      }
    }
    out.end();
    await finished(out);
  } catch (error) {
    out.destroy();
    await rm(tempPath, { force: true }).catch(() => undefined);
    throw error;
  }
  const info = await stat(tempPath);
  if (info.size > input.maxBytes) {
    await rm(tempPath, { force: true });
    throw new Error("media_too_large");
  }
  await rename(tempPath, finalPath);
  return { sizeBytes: info.size, detectedKind };
}

export function openMediaReadStream(root: string, storageKey: string): Readable {
  return createReadStream(absolutePathForKey(root, storageKey));
}

export async function deleteMediaFile(root: string, storageKey: string): Promise<void> {
  await rm(absolutePathForKey(root, storageKey), { force: true });
}

export function inlineContentType(kind: BroadcastContentKind, detectedMime: string | null): string {
  if (detectedMime) {
    return detectedMime;
  }
  switch (kind) {
    case "PHOTO":
      return "image/jpeg";
    case "VIDEO":
      return "video/mp4";
    case "AUDIO":
      return "audio/mpeg";
    case "VOICE":
      return "audio/ogg";
    case "ANIMATION":
      return "image/gif";
    default:
      return "application/octet-stream";
  }
}

export async function hashStorageKey(root: string, storageKey: string): Promise<string> {
  const hash = createHash("sha256");
  const stream = createReadStream(absolutePathForKey(root, storageKey));
  for await (const chunk of stream) {
    hash.update(chunk);
  }
  return hash.digest("hex");
}

export function uploadByteLimit(kind: BroadcastContentKind): number {
  return productMaxUploadBytes(kind);
}
