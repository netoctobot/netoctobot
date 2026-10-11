import type { BroadcastContentKind } from "@prisma/client";

/** Telegram Bot API documented limits (approximate; verify when upgrading). */
export const TELEGRAM_LIMITS = {
  textMessageChars: 4096,
  mediaCaptionChars: 1024,
  inlineButtonTextChars: 64,
  inlineButtonsTotal: 100,
  photoBytes: 10 * 1024 * 1024,
  videoBytes: 50 * 1024 * 1024,
  documentBytes: 50 * 1024 * 1024,
  audioBytes: 50 * 1024 * 1024,
  voiceBytes: 50 * 1024 * 1024,
  animationBytes: 50 * 1024 * 1024,
} as const;

/** Product upload ceiling (may be stricter than Telegram). */
export const PRODUCT_LIMITS = {
  uploadBytes: 50 * 1024 * 1024,
  orphanUploadTtlHours: 24,
  fileDeleteAfterCampaignEndHours: 48,
} as const;

export interface LinkButtonRow {
  text: string;
  url: string;
}

export type LinkButtonMatrix = LinkButtonRow[][];

export interface ParsedBroadcastContent {
  contentKind: BroadcastContentKind;
  text: string;
  caption: string | null;
  linkButtons: LinkButtonMatrix | null;
  mediaUploadId: string | null;
}

const URL_PATTERN = /^https?:\/\/.+/i;

export function maxBytesForKind(kind: BroadcastContentKind): number {
  switch (kind) {
    case "PHOTO":
      return TELEGRAM_LIMITS.photoBytes;
    case "VIDEO":
      return TELEGRAM_LIMITS.videoBytes;
    case "AUDIO":
      return TELEGRAM_LIMITS.audioBytes;
    case "VOICE":
      return TELEGRAM_LIMITS.voiceBytes;
    case "ANIMATION":
      return TELEGRAM_LIMITS.animationBytes;
    case "DOCUMENT":
      return TELEGRAM_LIMITS.documentBytes;
    default:
      return PRODUCT_LIMITS.uploadBytes;
  }
}

export function productMaxUploadBytes(kind: BroadcastContentKind): number {
  return Math.min(PRODUCT_LIMITS.uploadBytes, maxBytesForKind(kind));
}

export function parseLinkButtons(value: unknown): LinkButtonMatrix | null {
  if (value === undefined || value === null) {
    return null;
  }
  if (!value || typeof value !== "object" || !Array.isArray((value as { rows?: unknown }).rows)) {
    return null;
  }
  const rows = (value as { rows: unknown }).rows;
  if (!Array.isArray(rows) || rows.length === 0) {
    return null;
  }
  const matrix: LinkButtonMatrix = [];
  let total = 0;
  for (const row of rows) {
    if (!Array.isArray(row)) {
      return null;
    }
    const parsedRow: LinkButtonRow[] = [];
    for (const cell of row) {
      if (!cell || typeof cell !== "object") {
        return null;
      }
      const text = typeof (cell as LinkButtonRow).text === "string" ? (cell as LinkButtonRow).text.trim() : "";
      const url = typeof (cell as LinkButtonRow).url === "string" ? (cell as LinkButtonRow).url.trim() : "";
      if (!text || !url || text.length > TELEGRAM_LIMITS.inlineButtonTextChars || !URL_PATTERN.test(url)) {
        return null;
      }
      total += 1;
      if (total > TELEGRAM_LIMITS.inlineButtonsTotal) {
        return null;
      }
      parsedRow.push({ text, url });
    }
    if (parsedRow.length > 0) {
      matrix.push(parsedRow);
    }
  }
  return matrix.length > 0 ? matrix : null;
}

export function detectContentKindFromBuffer(head: Buffer): BroadcastContentKind | null {
  if (head.length >= 3 && head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) {
    return "PHOTO";
  }
  if (
    head.length >= 8 &&
    head[0] === 0x89 &&
    head[1] === 0x50 &&
    head[2] === 0x4e &&
    head[3] === 0x47
  ) {
    return "PHOTO";
  }
  if (head.length >= 12 && head.toString("ascii", 0, 4) === "RIFF" && head.toString("ascii", 8, 12) === "WEBP") {
    return "PHOTO";
  }
  if (head.length >= 6 && (head.toString("ascii", 0, 3) === "GIF" || head.toString("ascii", 0, 3) === "gif")) {
    return "ANIMATION";
  }
  if (head.length >= 12 && head.toString("ascii", 4, 8) === "ftyp") {
    return "VIDEO";
  }
  if (head.length >= 4 && head.toString("ascii", 0, 4) === "OggS") {
    return "VOICE";
  }
  if (head.length >= 3 && head.toString("ascii", 0, 3) === "ID3") {
    return "AUDIO";
  }
  if (head.length >= 2 && head[0] === 0xff && (head[1] & 0xe0) === 0xe0) {
    return "AUDIO";
  }
  if (head.length >= 5 && head.toString("ascii", 0, 5) === "%PDF-") {
    return "DOCUMENT";
  }
  return "DOCUMENT";
}

export function kindMatchesDetection(
  declared: BroadcastContentKind,
  detected: BroadcastContentKind,
): boolean {
  if (declared === detected) {
    return true;
  }
  if (declared === "PHOTO" && detected === "PHOTO") {
    return true;
  }
  if (declared === "ANIMATION" && detected === "ANIMATION") {
    return true;
  }
  if (declared === "DOCUMENT" && detected === "DOCUMENT") {
    return true;
  }
  return false;
}

export function parseBroadcastContent(body: Record<string, unknown>): ParsedBroadcastContent | null {
  const contentKind =
    body.contentKind === "TEXT" ||
    body.contentKind === "PHOTO" ||
    body.contentKind === "VIDEO" ||
    body.contentKind === "AUDIO" ||
    body.contentKind === "VOICE" ||
    body.contentKind === "DOCUMENT" ||
    body.contentKind === "ANIMATION"
      ? body.contentKind
      : body.contentKind === undefined
        ? "TEXT"
        : null;
  if (!contentKind) {
    return null;
  }
  const text = typeof body.text === "string" ? body.text : "";
  const captionRaw = typeof body.caption === "string" ? body.caption.trim() : "";
  const caption = captionRaw.length > 0 ? captionRaw : null;
  const linkButtons =
    body.linkButtons === undefined || body.linkButtons === null
      ? null
      : parseLinkButtons(body.linkButtons);
  if (body.linkButtons !== undefined && body.linkButtons !== null && linkButtons === null) {
    return null;
  }
  const mediaUploadId =
    typeof body.mediaUploadId === "string" && body.mediaUploadId.length > 0
      ? body.mediaUploadId
      : null;

  if (contentKind === "TEXT") {
    const trimmed = text.trim();
    if (!trimmed || trimmed.length > TELEGRAM_LIMITS.textMessageChars) {
      return null;
    }
    if (mediaUploadId) {
      return null;
    }
    if (caption) {
      return null;
    }
    return { contentKind, text: trimmed, caption: null, linkButtons, mediaUploadId: null };
  }

  if (!mediaUploadId) {
    return null;
  }
  if (caption && caption.length > TELEGRAM_LIMITS.mediaCaptionChars) {
    return null;
  }
  if (text.trim().length > 0) {
    return null;
  }
  return { contentKind, text: "", caption, linkButtons, mediaUploadId };
}

export function messageBodyForSend(content: ParsedBroadcastContent): string {
  if (content.contentKind === "TEXT") {
    return content.text;
  }
  return content.caption ?? "";
}
