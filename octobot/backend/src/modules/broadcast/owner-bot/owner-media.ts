import type { Message } from "grammy/types";
import type { BroadcastContentKind } from "@prisma/client";
import { TELEGRAM_LIMITS } from "../content.js";

export const OWNER_BROADCAST_VIDEO_MAX_BYTES = 5 * 1024 * 1024;

export function detectOwnerBroadcastMediaFromMessage(
  message: Message,
): { kind: BroadcastContentKind; fileId: string; originalName: string } | null {
  if (message.photo?.length) {
    const photo = message.photo[message.photo.length - 1];
    return { kind: "PHOTO", fileId: photo.file_id, originalName: "photo.jpg" };
  }
  if (message.animation) {
    return {
      kind: "ANIMATION",
      fileId: message.animation.file_id,
      originalName: message.animation.file_name ?? "animation.mp4",
    };
  }
  if (message.video) {
    return {
      kind: "VIDEO",
      fileId: message.video.file_id,
      originalName: message.video.file_name ?? "video.mp4",
    };
  }
  return null;
}

export function ownerBroadcastMaxBytesForKind(kind: BroadcastContentKind): number {
  if (kind === "VIDEO") {
    return OWNER_BROADCAST_VIDEO_MAX_BYTES;
  }
  if (kind === "PHOTO") {
    return TELEGRAM_LIMITS.photoBytes;
  }
  if (kind === "ANIMATION") {
    return TELEGRAM_LIMITS.animationBytes;
  }
  return TELEGRAM_LIMITS.photoBytes;
}

export function isCaptionWithinLimit(caption: string): boolean {
  return caption.length <= TELEGRAM_LIMITS.mediaCaptionChars;
}

export function resolveMediaCaption(input: {
  messageCaption?: string;
  textFromTextPost: string | null;
  existingCaption: string | null | undefined;
}): string {
  if (input.messageCaption?.trim()) {
    return input.messageCaption.trim();
  }
  if (input.textFromTextPost) {
    return input.textFromTextPost;
  }
  return input.existingCaption?.trim() ?? "";
}
