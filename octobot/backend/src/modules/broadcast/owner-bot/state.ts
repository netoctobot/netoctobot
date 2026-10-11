import type { Redis } from "ioredis";
import type { BroadcastContentKind } from "@prisma/client";
import type { LinkButtonMatrix } from "../content.js";
import type { OwnerAudience } from "../owner-broadcast-guard.js";

export const OWNER_BROADCAST_DRAFT_TTL_SECONDS = 45 * 60;

export type OwnerBroadcastStep =
  | "audience"
  | "awaitPost"
  | "preview"
  | "awaitMedia"
  | "awaitButtons";

export type OwnerBroadcastInputMode = "media" | "buttons" | null;

export type OwnerBroadcastPanelSurface = "text" | "media";

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
  panelSurface?: OwnerBroadcastPanelSurface;
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

export function emptyOwnerBroadcastDraft(): OwnerBroadcastDraft {
  return { step: "audience" };
}

export function hasPublishableContent(draft: OwnerBroadcastDraft): boolean {
  if (draft.contentKind === "TEXT") {
    return Boolean(draft.text?.trim());
  }
  return Boolean(draft.mediaAssetId);
}

export function cancelInputMode(draft: OwnerBroadcastDraft): OwnerBroadcastDraft {
  const next = { ...draft, inputMode: null };
  if (hasPublishableContent(next)) {
    next.step = "preview";
  }
  return next;
}

export function applyAudienceSelection(
  draft: OwnerBroadcastDraft,
  audience: OwnerAudience,
): OwnerBroadcastDraft {
  const next: OwnerBroadcastDraft = { ...draft, audience, inputMode: null };
  if (hasPublishableContent(next)) {
    next.step = "preview";
  } else {
    next.step = "awaitPost";
  }
  return next;
}

export function applyBackNavigation(
  draft: OwnerBroadcastDraft,
): OwnerBroadcastDraft | "home" {
  if (draft.inputMode === "media" || draft.inputMode === "buttons") {
    return cancelInputMode(draft);
  }
  if (draft.step === "preview" || draft.step === "awaitPost") {
    return { ...draft, step: "audience", inputMode: null };
  }
  if (draft.step === "audience") {
    return "home";
  }
  return { ...draft, step: "audience", inputMode: null };
}

export function textBodyForCaptionMigration(draft: OwnerBroadcastDraft): string | null {
  if (draft.contentKind === "TEXT" && draft.text?.trim()) {
    return draft.text.trim();
  }
  return null;
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
