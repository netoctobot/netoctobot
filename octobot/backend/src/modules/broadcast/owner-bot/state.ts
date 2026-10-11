import type { Redis } from "ioredis";
import type { BroadcastContentKind } from "@prisma/client";
import type { LinkButtonMatrix } from "../content.js";
import type { OwnerAudience } from "../owner-broadcast-guard.js";

export const OWNER_BROADCAST_DRAFT_TTL_SECONDS = 45 * 60;

export type OwnerBroadcastStep =
  | "audience"
  | "contentKind"
  | "awaitContent"
  | "compose"
  | "awaitButtons"
  | "preview"
  | "awaitCaption";

export type OwnerBroadcastInputMode = "caption" | "buttons" | null;

export interface OwnerBroadcastDraft {
  step: OwnerBroadcastStep;
  audience?: OwnerAudience;
  contentKind?: BroadcastContentKind;
  text?: string;
  caption?: string | null;
  linkButtons?: LinkButtonMatrix | null;
  mediaAssetId?: string | null;
  publishNonce?: string | null;
  inputMode?: OwnerBroadcastInputMode;
  previewMessageId?: number | null;
}

export interface OwnerBroadcastLastResult {
  campaignId: string;
}

function draftKey(botId: string, ownerTelegramId: number | bigint): string {
  return `bot:owner-broadcast:${botId}:${ownerTelegramId}`;
}

function resultKey(botId: string, ownerTelegramId: number | bigint): string {
  return `bot:owner-bc-last:${botId}:${ownerTelegramId}`;
}

export async function loadOwnerBroadcastDraft(
  redis: Redis,
  botId: string,
  ownerTelegramId: number | bigint,
): Promise<OwnerBroadcastDraft | null> {
  const raw = await redis.get(draftKey(botId, ownerTelegramId));
  if (!raw) {
    return null;
  }
  return JSON.parse(raw) as OwnerBroadcastDraft;
}

export async function saveOwnerBroadcastDraft(
  redis: Redis,
  botId: string,
  ownerTelegramId: number | bigint,
  draft: OwnerBroadcastDraft,
): Promise<void> {
  await redis.set(
    draftKey(botId, ownerTelegramId),
    JSON.stringify(draft),
    "EX",
    OWNER_BROADCAST_DRAFT_TTL_SECONDS,
  );
}

export async function clearOwnerBroadcastDraft(
  redis: Redis,
  botId: string,
  ownerTelegramId: number | bigint,
): Promise<void> {
  await redis.del(draftKey(botId, ownerTelegramId));
}

export async function saveOwnerBroadcastLastResult(
  redis: Redis,
  botId: string,
  ownerTelegramId: number | bigint,
  result: OwnerBroadcastLastResult,
): Promise<void> {
  await redis.set(
    resultKey(botId, ownerTelegramId),
    JSON.stringify(result),
    "EX",
    7 * 24 * 60 * 60,
  );
}

export async function loadOwnerBroadcastLastResult(
  redis: Redis,
  botId: string,
  ownerTelegramId: number | bigint,
): Promise<OwnerBroadcastLastResult | null> {
  const raw = await redis.get(resultKey(botId, ownerTelegramId));
  if (!raw) {
    return null;
  }
  return JSON.parse(raw) as OwnerBroadcastLastResult;
}

export function clearContentForKindChange(
  draft: OwnerBroadcastDraft,
  contentKind: BroadcastContentKind,
): OwnerBroadcastDraft {
  const next: OwnerBroadcastDraft = {
    ...draft,
    contentKind,
    step: "awaitContent",
    inputMode: null,
    text: "",
    caption: null,
    mediaAssetId: null,
    linkButtons: draft.linkButtons ?? null,
  };
  if (contentKind === "TEXT") {
    next.caption = null;
    next.mediaAssetId = null;
  } else {
    next.text = "";
  }
  return next;
}
