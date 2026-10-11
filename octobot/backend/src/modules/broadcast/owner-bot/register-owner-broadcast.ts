import { randomUUID } from "node:crypto";
import type { Context } from "grammy";
import type { PrismaClient, SupportedLanguage } from "@prisma/client";
import type { Redis } from "ioredis";
import type { Env } from "../../../config/env.js";
import { decryptToken } from "../../../lib/token-crypto.js";
import { translate } from "../../localization/localization.service.js";
import { normalizeTelegramLanguage } from "../../localization/localization.service.js";
import type { DashboardView } from "../../bots/platform-menu.js";
import type { ManagedBotRuntime } from "../../bots/bot-runtime-manager.js";
import { broadcastProbe, createBotTokenValidator } from "../probe.js";
import { previewBroadcast } from "../service.js";
import {
  assertOwnerBotAccess,
  OwnerBroadcastAccessError,
  type OwnerAudience,
} from "../owner-broadcast-guard.js";
import type { BroadcastScheduler } from "../scheduler.js";
import { buildOwnerBroadcastAudienceMenu } from "./menu.js";
import { parseOwnerBroadcastButtonText } from "./button-text.js";
import {
  applyAudienceSelection,
  applyBackNavigation,
  cancelInputMode,
  clearOwnerBroadcastDraft,
  emptyOwnerBroadcastDraft,
  hasPublishableContent,
  loadOwnerBroadcastDraft,
  loadOwnerBroadcastLastResult,
  saveOwnerBroadcastDraft,
  textBodyForCaptionMigration,
  type OwnerBroadcastDraft,
} from "./state.js";
import { deleteDraftMediaForOwner, ingestTelegramFileForOwnerDraft } from "./media-ingest.js";
import {
  draftToBroadcastRequest,
  publishOwnerBroadcastCampaign,
} from "./owner-publish.js";
import { summarizeCampaignCounts } from "./results.js";
import {
  showOwnerBroadcastResultsPanel,
  syncOwnerBroadcastPanel,
} from "./owner-broadcast-preview.js";
import {
  detectOwnerBroadcastMediaFromMessage,
  isCaptionWithinLimit,
  resolveMediaCaption,
} from "./owner-media.js";

export interface OwnerBroadcastDeps {
  prisma: PrismaClient;
  redis: Redis;
  env: Env;
  scheduler: BroadcastScheduler;
  showDashboard: (
    context: Context,
    runtime: ManagedBotRuntime,
    view: DashboardView,
  ) => Promise<void>;
  editDashboard: (
    context: Context,
    runtime: ManagedBotRuntime,
    view: DashboardView,
  ) => Promise<void>;
  isOwner: (context: Context, runtime: ManagedBotRuntime) => Promise<boolean>;
  goHome: (context: Context, runtime: ManagedBotRuntime) => Promise<void>;
  interfaceLanguage?: (context: Context) => Promise<SupportedLanguage>;
}

async function ownerUiLanguage(
  deps: OwnerBroadcastDeps,
  context: Context,
): Promise<SupportedLanguage> {
  if (deps.interfaceLanguage && context.from) {
    return deps.interfaceLanguage(context);
  }
  return normalizeTelegramLanguage(context.from?.language_code);
}

export async function presentBroadcastPanel(
  deps: OwnerBroadcastDeps,
  context: Context,
  runtime: ManagedBotRuntime,
  view: DashboardView,
): Promise<void> {
  if (context.callbackQuery) {
    await deps.editDashboard(context, runtime, view);
    return;
  }
  await deps.showDashboard(context, runtime, view);
}

async function requireOwnerBroadcastContext(
  deps: OwnerBroadcastDeps,
  runtime: ManagedBotRuntime,
  context: Context,
): Promise<OwnerBroadcastDraft | null> {
  if (!context.from || !(await deps.isOwner(context, runtime))) {
    return null;
  }
  try {
    await assertOwnerBotAccess(deps.prisma, runtime.botRecord.id, context.from.id);
  } catch (error) {
    if (error instanceof OwnerBroadcastAccessError) {
      const language = await ownerUiLanguage(deps, context);
      await context.answerCallbackQuery?.({
        text: translate(language, "ownerBroadcast.botInactive"),
        show_alert: true,
      });
    }
    return null;
  }
  return loadOwnerBroadcastDraft(deps.redis, runtime.botRecord.id, context.from.id);
}

async function refreshLastResultsPanel(
  deps: OwnerBroadcastDeps,
  context: Context,
  runtime: ManagedBotRuntime,
  language: SupportedLanguage,
): Promise<boolean> {
  if (!context.from) {
    return false;
  }
  const last = await loadOwnerBroadcastLastResult(
    deps.redis,
    runtime.botRecord.id,
    context.from.id,
  );
  if (!last) {
    return false;
  }
  const summary = await summarizeCampaignCounts(deps.prisma, last.campaignId);
  return showOwnerBroadcastResultsPanel({
    context,
    runtime,
    redis: deps.redis,
    language,
    summaryText: summary,
  });
}

/** Active draft, or recover results UI after publish cleared the draft. */
type DraftGate = OwnerBroadcastDraft | "recovered" | null;

async function ensureActiveDraft(
  deps: OwnerBroadcastDeps,
  runtime: ManagedBotRuntime,
  context: Context,
): Promise<DraftGate> {
  const draft = await requireOwnerBroadcastContext(deps, runtime, context);
  if (draft) {
    return draft;
  }
  if (!context.from) {
    return null;
  }
  const language = await ownerUiLanguage(deps, context);
  const recovered = await refreshLastResultsPanel(deps, context, runtime, language);
  if (recovered) {
    await context.answerCallbackQuery({
      text: translate(language, "ownerBroadcast.sessionEnded"),
      show_alert: true,
    });
    return "recovered";
  }
  return null;
}

export async function completeOwnerBroadcastPublish(
  deps: OwnerBroadcastDeps,
  context: Context,
  runtime: ManagedBotRuntime,
  existing: OwnerBroadcastDraft,
): Promise<void> {
  if (!context.from) {
    return;
  }
  const language = await ownerUiLanguage(deps, context);
  const request = draftToBroadcastRequest(runtime.botRecord.id, existing);
  const publishNonce = existing.publishNonce ?? randomUUID();
  if (!request) {
    await refreshLastResultsPanel(deps, context, runtime, language);
    return;
  }
  const probe = broadcastProbe(deps.prisma, deps.env.ENCRYPTION_KEY);
  const tokenValid = createBotTokenValidator(deps.prisma, deps.env.ENCRYPTION_KEY);
  const preview = await previewBroadcast(deps.prisma, request, probe, tokenValid);
  if (!preview) {
    throw new Error("invalid_broadcast");
  }
  const { campaignId } = await publishOwnerBroadcastCampaign({
    prisma: deps.prisma,
    redis: deps.redis,
    scheduler: deps.scheduler,
    botId: runtime.botRecord.id,
    ownerTelegramId: context.from.id,
    publishNonce,
    request,
    probe,
    tokenValid,
  });
  await applyPostPublishUi(deps, context, runtime, campaignId, language);
}

export async function applyPostPublishUi(
  deps: OwnerBroadcastDeps,
  context: Context,
  runtime: ManagedBotRuntime,
  campaignId: string,
  language: SupportedLanguage,
): Promise<void> {
  const summary = await summarizeCampaignCounts(deps.prisma, campaignId);
  const panelOk = await showOwnerBroadcastResultsPanel({
    context,
    runtime,
    redis: deps.redis,
    language,
    summaryText: summary,
  }).catch(() => false);
  if (!panelOk) {
    await context.answerCallbackQuery({
      text: translate(language, "ownerBroadcast.publishSucceededUiFailed"),
      show_alert: true,
    });
    return;
  }
  await context.answerCallbackQuery({
    text: translate(language, "ownerBroadcast.publishSucceeded"),
  });
}

async function persistDraftAndSync(
  deps: OwnerBroadcastDeps,
  context: Context,
  runtime: ManagedBotRuntime,
  draft: OwnerBroadcastDraft,
  errorLine?: string,
): Promise<OwnerBroadcastDraft> {
  if (!context.from) {
    return draft;
  }
  await saveOwnerBroadcastDraft(
    deps.redis,
    runtime.botRecord.id,
    context.from.id,
    draft,
  );
  const language = await ownerUiLanguage(deps, context);
  return syncOwnerBroadcastPanel({
    context,
    runtime,
    prisma: deps.prisma,
    redis: deps.redis,
    env: deps.env,
    language,
    draft,
    errorLine,
  });
}

function shouldInterceptOwnerMessage(draft: OwnerBroadcastDraft): boolean {
  return draft.step !== "audience";
}

function scheduleDeleteUserMessage(context: Context, messageId: number): void {
  setTimeout(() => {
    void context.api.deleteMessage(context.chat!.id, messageId).catch(() => undefined);
  }, 3000);
}

export function registerOwnerBroadcastHandlers(
  runtime: ManagedBotRuntime,
  deps: OwnerBroadcastDeps,
): void {
  const bot = runtime.bot;

  bot.callbackQuery("owner:bc:start", async (context) => {
    if (!context.from || !(await deps.isOwner(context, runtime))) {
      return;
    }
    try {
      await assertOwnerBotAccess(deps.prisma, runtime.botRecord.id, context.from.id);
    } catch {
      await context.answerCallbackQuery();
      return;
    }
    await deleteDraftMediaForOwner(
      deps.prisma,
      deps.env.BROADCAST_MEDIA_DIR,
      runtime.botRecord.id,
      BigInt(context.from.id),
    );
    await clearOwnerBroadcastDraft(deps.redis, runtime.botRecord.id, context.from.id);
    const language = await ownerUiLanguage(deps, context);
    await presentBroadcastPanel(
      deps,
      context,
      runtime,
      buildOwnerBroadcastAudienceMenu(language),
    );
    await context.answerCallbackQuery();
  });

  bot.callbackQuery(/^owner:bc:aud:(channels|users|both)$/, async (context) => {
    if (!context.from || !context.match) {
      return;
    }
    if (!(await deps.isOwner(context, runtime))) {
      await context.answerCallbackQuery();
      return;
    }
    try {
      await assertOwnerBotAccess(deps.prisma, runtime.botRecord.id, context.from.id);
    } catch {
      await context.answerCallbackQuery();
      return;
    }
    const existing = await loadOwnerBroadcastDraft(
      deps.redis,
      runtime.botRecord.id,
      context.from.id,
    );
    const audience = context.match[1] as OwnerAudience;
    const base = existing ?? emptyOwnerBroadcastDraft();
    const draft = applyAudienceSelection(base, audience);
    await persistDraftAndSync(deps, context, runtime, draft);
    await context.answerCallbackQuery();
  });

  bot.callbackQuery("owner:bc:home", async (context) => {
    if (!(await deps.isOwner(context, runtime))) {
      return;
    }
    await deps.goHome(context, runtime);
    await context.answerCallbackQuery();
  });

  bot.callbackQuery("owner:bc:back", async (context) => {
    let existing = await requireOwnerBroadcastContext(deps, runtime, context);
    if (!existing || !context.from) {
      if (context.from) {
        const language = await ownerUiLanguage(deps, context);
        if (await refreshLastResultsPanel(deps, context, runtime, language)) {
          await context.answerCallbackQuery();
          return;
        }
      }
      await context.answerCallbackQuery();
      return;
    }
    const next = applyBackNavigation(existing);
    if (next === "home") {
      await deps.goHome(context, runtime);
      await context.answerCallbackQuery();
      return;
    }
    if (next.step === "audience") {
      const language = await ownerUiLanguage(deps, context);
      await saveOwnerBroadcastDraft(deps.redis, runtime.botRecord.id, context.from.id, next);
      await presentBroadcastPanel(
        deps,
        context,
        runtime,
        buildOwnerBroadcastAudienceMenu(language),
      );
    } else {
      await persistDraftAndSync(deps, context, runtime, next);
    }
    await context.answerCallbackQuery();
  });

  bot.callbackQuery("owner:bc:media", async (context) => {
    const gate = await ensureActiveDraft(deps, runtime, context);
    if (gate === "recovered") {
      return;
    }
    if (gate === null) {
      await context.answerCallbackQuery().catch(() => undefined);
      return;
    }
    const existing = gate;
    const draft: OwnerBroadcastDraft = {
      ...existing,
      inputMode: "media",
      step: "awaitMedia",
    };
    await persistDraftAndSync(deps, context, runtime, draft);
    await context.answerCallbackQuery();
  });

  bot.callbackQuery("owner:bc:buttons", async (context) => {
    const gate = await ensureActiveDraft(deps, runtime, context);
    if (gate === "recovered") {
      return;
    }
    if (gate === null) {
      await context.answerCallbackQuery().catch(() => undefined);
      return;
    }
    const existing = gate;
    const draft: OwnerBroadcastDraft = {
      ...existing,
      inputMode: "buttons",
      step: "awaitButtons",
    };
    await persistDraftAndSync(deps, context, runtime, draft);
    await context.answerCallbackQuery();
  });

  bot.callbackQuery("owner:bc:removeText", async (context) => {
    const gate = await ensureActiveDraft(deps, runtime, context);
    if (gate === "recovered") {
      return;
    }
    if (gate === null) {
      await context.answerCallbackQuery().catch(() => undefined);
      return;
    }
    const existing = gate;
    const draft: OwnerBroadcastDraft = { ...existing, caption: null, inputMode: null, step: "preview" };
    await persistDraftAndSync(deps, context, runtime, draft);
    await context.answerCallbackQuery();
  });

  bot.callbackQuery("owner:bc:removeButtons", async (context) => {
    const gate = await ensureActiveDraft(deps, runtime, context);
    if (gate === "recovered") {
      return;
    }
    if (gate === null) {
      await context.answerCallbackQuery().catch(() => undefined);
      return;
    }
    const existing = gate;
    const draft: OwnerBroadcastDraft = {
      ...existing,
      linkButtons: null,
      inputMode: null,
      step: "preview",
    };
    await persistDraftAndSync(deps, context, runtime, draft);
    await context.answerCallbackQuery();
  });

  bot.callbackQuery("owner:bc:publish", async (context) => {
    const existing = await requireOwnerBroadcastContext(deps, runtime, context);
    if (!context.from) {
      await context.answerCallbackQuery().catch(() => undefined);
      return;
    }
    const language = await ownerUiLanguage(deps, context);
    if (!existing) {
      const recovered = await refreshLastResultsPanel(deps, context, runtime, language);
      await context.answerCallbackQuery({
        text: translate(
          language,
          recovered ? "ownerBroadcast.sessionEnded" : "ownerBroadcast.invalidInput",
        ),
        show_alert: true,
      });
      return;
    }
    try {
      await completeOwnerBroadcastPublish(deps, context, runtime, existing);
    } catch {
      await context.answerCallbackQuery({
        text: translate(language, "ownerBroadcast.invalidInput"),
        show_alert: true,
      });
    }
  });
}

export async function tryOwnerBroadcastOwnerMessage(
  context: Context,
  runtime: ManagedBotRuntime,
  deps: OwnerBroadcastDeps,
): Promise<boolean> {
  if (!context.from || context.chat?.type !== "private" || !context.message) {
    return false;
  }
  if (!(await deps.isOwner(context, runtime))) {
    return false;
  }
  try {
    await assertOwnerBotAccess(deps.prisma, runtime.botRecord.id, context.from.id);
  } catch {
    return false;
  }
  const draft = await loadOwnerBroadcastDraft(
    deps.redis,
    runtime.botRecord.id,
    context.from.id,
  );
  if (!draft || !shouldInterceptOwnerMessage(draft)) {
    return false;
  }

  const language = await ownerUiLanguage(deps, context);
  const messageId = context.message.message_id;
  const errorPrefix = (key: "ownerBroadcast.invalidInput" | "ownerBroadcast.captionTooLong") =>
    translate(language, key);

  if (draft.inputMode === "buttons") {
    if (!context.message.text) {
      return true;
    }
    const parsed = parseOwnerBroadcastButtonText(context.message.text);
    if (!parsed.ok) {
      await persistDraftAndSync(deps, context, runtime, draft, errorPrefix("ownerBroadcast.invalidInput"));
      scheduleDeleteUserMessage(context, messageId);
      return true;
    }
    const next: OwnerBroadcastDraft = {
      ...cancelInputMode(draft),
      linkButtons: parsed.rows,
      step: "preview",
    };
    await persistDraftAndSync(deps, context, runtime, next);
    scheduleDeleteUserMessage(context, messageId);
    return true;
  }

  if (draft.inputMode === "media" || draft.step === "awaitMedia") {
    const media = detectOwnerBroadcastMediaFromMessage(context.message);
    if (media) {
      const textFromPost = textBodyForCaptionMigration(draft);
      const caption = resolveMediaCaption({
        messageCaption: context.message.caption,
        textFromTextPost: textFromPost,
        existingCaption: draft.caption,
      });
      if (!isCaptionWithinLimit(caption)) {
        await persistDraftAndSync(deps, context, runtime, draft, errorPrefix("ownerBroadcast.captionTooLong"));
        scheduleDeleteUserMessage(context, messageId);
        return true;
      }
      const { userId } = await assertOwnerBotAccess(
        deps.prisma,
        runtime.botRecord.id,
        context.from.id,
      );
      await deleteDraftMediaForOwner(
        deps.prisma,
        deps.env.BROADCAST_MEDIA_DIR,
        runtime.botRecord.id,
        BigInt(context.from.id),
      );
      const token = ownerBroadcastBotToken(runtime, deps.env);
      const ingested = await ingestTelegramFileForOwnerDraft({
        api: context.api,
        botToken: token,
        prisma: deps.prisma,
        mediaRoot: deps.env.BROADCAST_MEDIA_DIR,
        botId: runtime.botRecord.id,
        userId,
        ownerTelegramId: BigInt(context.from.id),
        fileId: media.fileId,
        declaredKind: media.kind,
        originalName: media.originalName,
      });
      if ("error" in ingested) {
        await persistDraftAndSync(deps, context, runtime, draft, errorPrefix("ownerBroadcast.invalidInput"));
        scheduleDeleteUserMessage(context, messageId);
        return true;
      }
      const next: OwnerBroadcastDraft = {
        ...draft,
        contentKind: media.kind,
        mediaAssetId: ingested.mediaAssetId,
        text: "",
        caption: caption || null,
        inputMode: null,
        step: "preview",
      };
      await persistDraftAndSync(deps, context, runtime, next);
      scheduleDeleteUserMessage(context, messageId);
      return true;
    }
    if (context.message.text?.trim()) {
      const caption = resolveMediaCaption({
        messageCaption: context.message.text,
        textFromTextPost: null,
        existingCaption: draft.caption,
      });
      if (!isCaptionWithinLimit(caption)) {
        await persistDraftAndSync(deps, context, runtime, draft, errorPrefix("ownerBroadcast.captionTooLong"));
        scheduleDeleteUserMessage(context, messageId);
        return true;
      }
      const next: OwnerBroadcastDraft = {
        ...draft,
        caption: caption || null,
        inputMode: null,
        step: "preview",
      };
      await persistDraftAndSync(deps, context, runtime, next);
      scheduleDeleteUserMessage(context, messageId);
      return true;
    }
    await persistDraftAndSync(deps, context, runtime, draft, errorPrefix("ownerBroadcast.invalidInput"));
    scheduleDeleteUserMessage(context, messageId);
    return true;
  }

  if (draft.step === "awaitPost") {
    const media = detectOwnerBroadcastMediaFromMessage(context.message);
    if (media) {
      const textFromPost = textBodyForCaptionMigration(draft);
      const caption = resolveMediaCaption({
        messageCaption: context.message.caption,
        textFromTextPost: textFromPost,
        existingCaption: draft.caption,
      });
      if (!isCaptionWithinLimit(caption)) {
        await persistDraftAndSync(deps, context, runtime, draft, errorPrefix("ownerBroadcast.captionTooLong"));
        scheduleDeleteUserMessage(context, messageId);
        return true;
      }
      const { userId } = await assertOwnerBotAccess(
        deps.prisma,
        runtime.botRecord.id,
        context.from.id,
      );
      await deleteDraftMediaForOwner(
        deps.prisma,
        deps.env.BROADCAST_MEDIA_DIR,
        runtime.botRecord.id,
        BigInt(context.from.id),
      );
      const token = ownerBroadcastBotToken(runtime, deps.env);
      const ingested = await ingestTelegramFileForOwnerDraft({
        api: context.api,
        botToken: token,
        prisma: deps.prisma,
        mediaRoot: deps.env.BROADCAST_MEDIA_DIR,
        botId: runtime.botRecord.id,
        userId,
        ownerTelegramId: BigInt(context.from.id),
        fileId: media.fileId,
        declaredKind: media.kind,
        originalName: media.originalName,
      });
      if ("error" in ingested) {
        await persistDraftAndSync(deps, context, runtime, draft, errorPrefix("ownerBroadcast.invalidInput"));
        scheduleDeleteUserMessage(context, messageId);
        return true;
      }
      const next: OwnerBroadcastDraft = {
        ...draft,
        contentKind: media.kind,
        mediaAssetId: ingested.mediaAssetId,
        text: "",
        caption: caption || null,
        step: "preview",
      };
      await persistDraftAndSync(deps, context, runtime, next);
      scheduleDeleteUserMessage(context, messageId);
      return true;
    }
    if (context.message.text?.trim()) {
      const next: OwnerBroadcastDraft = {
        ...draft,
        contentKind: "TEXT",
        text: context.message.text,
        caption: null,
        mediaAssetId: null,
        step: "preview",
      };
      await persistDraftAndSync(deps, context, runtime, next);
      scheduleDeleteUserMessage(context, messageId);
      return true;
    }
    await persistDraftAndSync(deps, context, runtime, draft, errorPrefix("ownerBroadcast.invalidInput"));
    scheduleDeleteUserMessage(context, messageId);
    return true;
  }

  if (draft.step === "preview" && !draft.inputMode) {
    return true;
  }

  return true;
}

export function ownerBroadcastBotToken(runtime: ManagedBotRuntime, env: Env): string {
  return decryptToken(runtime.botRecord.tokenEncrypted, env.ENCRYPTION_KEY);
}
