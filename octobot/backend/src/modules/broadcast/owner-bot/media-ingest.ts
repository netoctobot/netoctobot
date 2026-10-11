import { createWriteStream } from "node:fs";
import { rename, unlink } from "node:fs/promises";
import { pipeline } from "node:stream/promises";
import type { Api } from "grammy";
import type { Message } from "grammy/types";
import type { BroadcastContentKind, PrismaClient } from "@prisma/client";
import { Readable } from "node:stream";
import {
  detectContentKindFromBuffer,
  kindMatchesDetection,
} from "../content.js";
import { ownerBroadcastMaxBytesForKind } from "./owner-media.js";
import { PRODUCT_LIMITS } from "../content.js";
import {
  absolutePathForKey,
  deleteMediaFile,
  ensureMediaRoot,
  generateStorageKey,
  sanitizeBroadcastFilename,
} from "../media-storage.js";

/** Telegram Bot API file download limit (bytes). */
export const TELEGRAM_BOT_DOWNLOAD_LIMIT_BYTES = 20 * 1024 * 1024;

export function telegramFileRefForKind(
  message: Message,
  declaredKind: BroadcastContentKind,
): { fileId: string; originalName: string } | null {
  switch (declaredKind) {
    case "PHOTO": {
      const photo = message.photo?.[message.photo.length - 1];
      return photo ? { fileId: photo.file_id, originalName: "photo.jpg" } : null;
    }
    case "VIDEO":
      return message.video
        ? {
            fileId: message.video.file_id,
            originalName: message.video.file_name ?? "video.mp4",
          }
        : null;
    case "AUDIO":
      return message.audio
        ? {
            fileId: message.audio.file_id,
            originalName: message.audio.file_name ?? "audio.mp3",
          }
        : null;
    case "VOICE":
      return message.voice
        ? { fileId: message.voice.file_id, originalName: "voice.ogg" }
        : null;
    case "DOCUMENT":
      return message.document
        ? {
            fileId: message.document.file_id,
            originalName: message.document.file_name ?? "document",
          }
        : null;
    case "ANIMATION":
      return message.animation
        ? {
            fileId: message.animation.file_id,
            originalName: message.animation.file_name ?? "animation.mp4",
          }
        : null;
    default:
      return null;
  }
}

export async function ingestTelegramFileForOwnerDraft(input: {
  api: Api;
  botToken: string;
  prisma: PrismaClient;
  mediaRoot: string;
  botId: string;
  userId: string;
  ownerTelegramId: bigint;
  fileId: string;
  declaredKind: BroadcastContentKind;
  originalName: string;
}): Promise<{ mediaAssetId: string } | { error: string }> {
  const maxBytes = Math.min(
    ownerBroadcastMaxBytesForKind(input.declaredKind),
    TELEGRAM_BOT_DOWNLOAD_LIMIT_BYTES,
  );
  const file = await input.api.getFile(input.fileId);
  if (!file.file_path) {
    return { error: "telegram_file_unavailable" };
  }
  if (file.file_size && file.file_size > maxBytes) {
    return { error: "media_too_large" };
  }
  const storageKey = generateStorageKey();
  const finalPath = absolutePathForKey(input.mediaRoot, storageKey);
  const partialPath = `${finalPath}.partial`;
  await ensureMediaRoot(input.mediaRoot);
  const url = `https://api.telegram.org/file/bot${input.botToken}/${file.file_path}`;
  const response = await fetch(url);
  if (!response.ok || !response.body) {
    return { error: "telegram_download_failed" };
  }
  let received = 0;
  const limiter = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      received += chunk.length;
      if (received > maxBytes) {
        controller.error(new Error("media_too_large"));
        return;
      }
      controller.enqueue(chunk);
    },
  });
  try {
    const nodeStream = Readable.fromWeb(response.body.pipeThrough(limiter));
    await pipeline(nodeStream, createWriteStream(partialPath));
  } catch {
    await unlink(partialPath).catch(() => undefined);
    return { error: "media_too_large" };
  }
  const { readFile } = await import("node:fs/promises");
  const head = await readFile(partialPath, { encoding: null }).then((buf) =>
    buf.subarray(0, Math.min(512, buf.length)),
  );
  const detected = detectContentKindFromBuffer(head);
  if (!detected || !kindMatchesDetection(input.declaredKind, detected)) {
    await unlink(partialPath).catch(() => undefined);
    return { error: "media_type_mismatch" };
  }
  await rename(partialPath, finalPath);
  const expiresAt = new Date(Date.now() + PRODUCT_LIMITS.orphanUploadTtlHours * 60 * 60 * 1000);
  const row = await input.prisma.broadcastMediaAsset.create({
    data: {
      uploaderBotId: input.botId,
      uploaderUserId: input.userId,
      draftOwnerTelegramId: input.ownerTelegramId,
      originalName: sanitizeBroadcastFilename(input.originalName),
      storageKey,
      contentKind: detected,
      sizeBytes: BigInt(received),
      expiresAt,
    },
  });
  return { mediaAssetId: row.id };
}

export async function deleteDraftMediaForOwner(
  prisma: PrismaClient,
  mediaRoot: string,
  botId: string,
  ownerTelegramId: bigint,
): Promise<void> {
  const assets = await prisma.broadcastMediaAsset.findMany({
    where: {
      uploaderBotId: botId,
      draftOwnerTelegramId: ownerTelegramId,
      campaign: null,
      fileDeletedAt: null,
    },
    select: { id: true, storageKey: true },
  });
  for (const asset of assets) {
    await deleteMediaFile(mediaRoot, asset.storageKey).catch(() => undefined);
    await prisma.broadcastMediaAsset.update({
      where: { id: asset.id },
      data: { fileDeletedAt: new Date() },
    });
  }
}
