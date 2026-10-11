import { randomUUID } from "node:crypto";
import type { Context } from "grammy";
import type { BroadcastContentKind, PrismaClient } from "@prisma/client";
import type { Redis } from "ioredis";
import type { Env } from "../../../config/env.js";
import { decryptToken } from "../../../lib/token-crypto.js";
import { translate } from "../../localization/localization.service.js";
import { normalizeTelegramLanguage } from "../../localization/localization.service.js";
import type { DashboardView } from "../../bots/platform-menu.js";
import type { ManagedBotRuntime } from "../../bots/bot-runtime-manager.js";
import { broadcastProbe, createBotTokenValidator } from "../probe.js";
import { previewBroadcast } from "../service.js";
import { assertOwnerBotAccess, OwnerBroadcastAccessError } from "../owner-broadcast-guard.js";
import type { BroadcastScheduler } from "../scheduler.js";
import {
  buildOwnerBroadcastAudienceMenu,
  buildOwnerBroadcastButtonHelp,
  buildOwnerBroadcastComposeMenu,
  buildOwnerBroadcastKindMenu,
  buildOwnerBroadcastPreviewMenu,
  buildOwnerBroadcastResultsMenu,
} from "./menu.js";
import { parseOwnerBroadcastButtonText } from "./button-text.js";
import {
  clearContentForKindChange,
  clearOwnerBroadcastDraft,
  loadOwnerBroadcastDraft,
  loadOwnerBroadcastLastResult,
  saveOwnerBroadcastDraft,
  type OwnerBroadcastDraft,
} from "./state.js";
import {
  deleteDraftMediaForOwner,
  ingestTelegramFileForOwnerDraft,
  telegramFileRefForKind,
} from "./media-ingest.js";
import {
  draftToBroadcastRequest,
  publishOwnerBroadcastCampaign,
} from "./owner-publish.js";
import { summarizeCampaignCounts } from "./results.js";

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
  isOwner: (context: Context, runtime: ManagedBotRuntime) => Promise<boolean>;
  goHome: (context: Context, runtime: ManagedBotRuntime) => Promise<void>;
}

async function ensureDraft(
  deps: OwnerBroadcastDeps,
  runtime: ManagedBotRuntime,
  context: Context,
): Promise<OwnerBroadcastDraft | null> {
  if (!context.from) {
    return null;
  }
  try {
    await assertOwnerBotAccess(deps.prisma, runtime.botRecord.id, context.from.id);
  } catch (error) {
    if (error instanceof OwnerBroadcastAccessError) {
      const language = normalizeTelegramLanguage(context.from.language_code);
      await context.answerCallbackQuery?.({
        text: translate(language, "ownerBroadcast.botInactive"),
        show_alert: true,
      });
    }
    return null;
  }
  const existing = await loadOwnerBroadcastDraft(
    deps.redis,
    runtime.botRecord.id,
    context.from.id,
  );
  return existing ?? { step: "audience" };
}

export function registerOwnerBroadcastHandlers(
  runtime: ManagedBotRuntime,
  deps: OwnerBroadcastDeps,
): void {
  const bot = runtime.bot;

  bot.callbackQuery("owner:bc:start", async (context) => {
    if (!(await deps.isOwner(context, runtime)) || !context.from) {
      return;
    }
    await deleteDraftMediaForOwner(
      deps.prisma,
      deps.env.BROADCAST_MEDIA_DIR,
      runtime.botRecord.id,
      BigInt(context.from.id),
    );
    await clearOwnerBroadcastDraft(deps.redis, runtime.botRecord.id, context.from.id);
    const language = normalizeTelegramLanguage(context.from.language_code);
    await deps.showDashboard(context, runtime, buildOwnerBroadcastAudienceMenu(language));
    await context.answerCallbackQuery();
  });

  bot.callbackQuery(/^owner:bc:aud:(channels|users|both)$/, async (context) => {
    if (!(await deps.isOwner(context, runtime)) || !context.from || !context.match) {
      return;
    }
    const audience = context.match[1] as "channels" | "users" | "both";
    const draft: OwnerBroadcastDraft = { step: "contentKind", audience };
    await saveOwnerBroadcastDraft(deps.redis, runtime.botRecord.id, context.from.id, draft);
    const language = normalizeTelegramLanguage(context.from.language_code);
    await deps.showDashboard(context, runtime, buildOwnerBroadcastKindMenu(language));
    await context.answerCallbackQuery();
  });

  bot.callbackQuery(/^owner:bc:kind:(.+)$/, async (context) => {
    if (!(await deps.isOwner(context, runtime)) || !context.from || !context.match) {
      return;
    }
    const draft = await ensureDraft(deps, runtime, context);
    if (!draft) {
      return;
    }
    const kind = context.match[1] as BroadcastContentKind;
    if (draft.contentKind && draft.contentKind !== kind) {
      await deleteDraftMediaForOwner(
        deps.prisma,
        deps.env.BROADCAST_MEDIA_DIR,
        runtime.botRecord.id,
        BigInt(context.from.id),
      );
    }
    const next = clearContentForKindChange(draft, kind);
    await saveOwnerBroadcastDraft(deps.redis, runtime.botRecord.id, context.from.id, next);
    const language = normalizeTelegramLanguage(context.from.language_code);
    await deps.showDashboard(
      context,
      runtime,
      buildOwnerBroadcastComposeMenu(language, next),
    );
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
    if (!(await deps.isOwner(context, runtime)) || !context.from) {
      return;
    }
    const draft = await loadOwnerBroadcastDraft(
      deps.redis,
      runtime.botRecord.id,
      context.from.id,
    );
    const language = normalizeTelegramLanguage(context.from.language_code);
    if (!draft || draft.step === "audience") {
      await deps.showDashboard(context, runtime, buildOwnerBroadcastAudienceMenu(language));
    } else if (draft.step === "contentKind" || !draft.contentKind) {
      await deps.showDashboard(context, runtime, buildOwnerBroadcastKindMenu(language));
    } else {
      const cleared = { ...draft, inputMode: null };
      await saveOwnerBroadcastDraft(deps.redis, runtime.botRecord.id, context.from.id, cleared);
      await deps.showDashboard(
        context,
        runtime,
        buildOwnerBroadcastComposeMenu(language, cleared),
      );
    }
    await context.answerCallbackQuery();
  });

  bot.callbackQuery("owner:bc:editText", async (context) => {
    if (!(await deps.isOwner(context, runtime)) || !context.from) {
      return;
    }
    const draft = await ensureDraft(deps, runtime, context);
    if (!draft) {
      return;
    }
    draft.inputMode = null;
    draft.step = "awaitContent";
    await saveOwnerBroadcastDraft(deps.redis, runtime.botRecord.id, context.from.id, draft);
    await context.answerCallbackQuery();
  });

  bot.callbackQuery("owner:bc:editCaption", async (context) => {
    if (!(await deps.isOwner(context, runtime)) || !context.from) {
      return;
    }
    const draft = await ensureDraft(deps, runtime, context);
    if (!draft) {
      return;
    }
    draft.inputMode = "caption";
    draft.step = "awaitCaption";
    await saveOwnerBroadcastDraft(deps.redis, runtime.botRecord.id, context.from.id, draft);
    await context.answerCallbackQuery();
  });

  bot.callbackQuery("owner:bc:removeCaption", async (context) => {
    if (!(await deps.isOwner(context, runtime)) || !context.from) {
      return;
    }
    const draft = await ensureDraft(deps, runtime, context);
    if (!draft) {
      return;
    }
    draft.caption = null;
    draft.inputMode = null;
    draft.step = "compose";
    await saveOwnerBroadcastDraft(deps.redis, runtime.botRecord.id, context.from.id, draft);
    const language = normalizeTelegramLanguage(context.from.language_code);
    await deps.showDashboard(
      context,
      runtime,
      buildOwnerBroadcastComposeMenu(language, draft),
    );
    await context.answerCallbackQuery();
  });

  bot.callbackQuery("owner:bc:editButtons", async (context) => {
    if (!(await deps.isOwner(context, runtime)) || !context.from) {
      return;
    }
    const draft = await ensureDraft(deps, runtime, context);
    if (!draft) {
      return;
    }
    draft.inputMode = "buttons";
    draft.step = "awaitButtons";
    const language = normalizeTelegramLanguage(context.from.language_code);
    await deps.showDashboard(context, runtime, buildOwnerBroadcastButtonHelp(language));
    await context.answerCallbackQuery();
  });

  bot.callbackQuery("owner:bc:removeButtons", async (context) => {
    if (!(await deps.isOwner(context, runtime)) || !context.from) {
      return;
    }
    const draft = await ensureDraft(deps, runtime, context);
    if (!draft) {
      return;
    }
    draft.linkButtons = null;
    draft.inputMode = null;
    draft.step = "compose";
    await saveOwnerBroadcastDraft(deps.redis, runtime.botRecord.id, context.from.id, draft);
    const language = normalizeTelegramLanguage(context.from.language_code);
    await deps.showDashboard(
      context,
      runtime,
      buildOwnerBroadcastComposeMenu(language, draft),
    );
    await context.answerCallbackQuery();
  });

  bot.callbackQuery("owner:bc:preview", async (context) => {
    if (!(await deps.isOwner(context, runtime)) || !context.from) {
      return;
    }
    const draft = await ensureDraft(deps, runtime, context);
    if (!draft) {
      return;
    }
    const request = draftToBroadcastRequest(runtime.botRecord.id, draft);
    if (!request) {
      return;
    }
    const probe = broadcastProbe(deps.prisma, deps.env.ENCRYPTION_KEY);
    const tokenValid = createBotTokenValidator(deps.prisma, deps.env.ENCRYPTION_KEY);
    const preview = await previewBroadcast(deps.prisma, request, probe, tokenValid);
    if (!preview) {
      return;
    }
    draft.publishNonce = draft.publishNonce ?? randomUUID();
    draft.step = "preview";
    await saveOwnerBroadcastDraft(deps.redis, runtime.botRecord.id, context.from.id, draft);
    const language = normalizeTelegramLanguage(context.from.language_code);
    const counts = `${preview.summary.preliminaryEligible} eligible, ${preview.summary.excluded} excluded`;
    await deps.showDashboard(
      context,
      runtime,
      buildOwnerBroadcastPreviewMenu(language, counts),
    );
    await context.answerCallbackQuery();
  });

  bot.callbackQuery("owner:bc:publish", async (context) => {
    if (!(await deps.isOwner(context, runtime)) || !context.from) {
      return;
    }
    const draft = await loadOwnerBroadcastDraft(
      deps.redis,
      runtime.botRecord.id,
      context.from.id,
    );
    const request = draft ? draftToBroadcastRequest(runtime.botRecord.id, draft) : null;
    const publishNonce = draft?.publishNonce ?? randomUUID();
    if (!request) {
      const last = await loadOwnerBroadcastLastResult(
        deps.redis,
        runtime.botRecord.id,
        context.from.id,
      );
      if (last) {
        const language = normalizeTelegramLanguage(context.from.language_code);
        const summary = await summarizeCampaignCounts(deps.prisma, last.campaignId);
        await deps.showDashboard(
          context,
          runtime,
          buildOwnerBroadcastResultsMenu(language, summary),
        );
      }
      await context.answerCallbackQuery();
      return;
    }
    const probe = broadcastProbe(deps.prisma, deps.env.ENCRYPTION_KEY);
    const tokenValid = createBotTokenValidator(deps.prisma, deps.env.ENCRYPTION_KEY);
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
    const language = normalizeTelegramLanguage(context.from.language_code);
    const summary = await summarizeCampaignCounts(deps.prisma, campaignId);
    await deps.showDashboard(
      context,
      runtime,
      buildOwnerBroadcastResultsMenu(language, summary),
    );
    await context.answerCallbackQuery();
  });
}

export async function tryOwnerBroadcastOwnerMessage(
  context: Context,
  runtime: ManagedBotRuntime,
  deps: OwnerBroadcastDeps,
): Promise<boolean> {
  if (!context.from || context.chat?.type !== "private") {
    return false;
  }
  if (!(await deps.isOwner(context, runtime))) {
    return false;
  }
  const draft = await loadOwnerBroadcastDraft(
    deps.redis,
    runtime.botRecord.id,
    context.from.id,
  );
  if (!draft) {
    return false;
  }
  const waitingForInput =
    draft.inputMode === "buttons" ||
    draft.inputMode === "caption" ||
    draft.step === "awaitContent" ||
    draft.step === "awaitCaption" ||
    draft.step === "awaitButtons" ||
    (draft.contentKind === "TEXT" &&
      (draft.step === "compose" || draft.step === "contentKind")) ||
    (draft.contentKind &&
      draft.contentKind !== "TEXT" &&
      (draft.step === "compose" || draft.step === "contentKind"));
  if (!waitingForInput || !context.message) {
    return false;
  }

  const language = normalizeTelegramLanguage(context.from.language_code);
  const messageId = context.message?.message_id;

  if (draft.inputMode === "buttons" && context.message?.text) {
    const parsed = parseOwnerBroadcastButtonText(context.message.text);
    if (!parsed.ok) {
      await deps.showDashboard(
        context,
        runtime,
        {
          ...buildOwnerBroadcastButtonHelp(language),
          text: `${buildOwnerBroadcastButtonHelp(language).text}\n\n${translate(language, "ownerBroadcast.invalidInput")}`,
        },
      );
      if (messageId) {
        setTimeout(() => {
          void context.api.deleteMessage(context.chat!.id, messageId).catch(() => undefined);
        }, 3000);
      }
      return true;
    }
    draft.linkButtons = parsed.rows;
    draft.inputMode = null;
    draft.step = "compose";
    await saveOwnerBroadcastDraft(deps.redis, runtime.botRecord.id, context.from.id, draft);
    await deps.showDashboard(
      context,
      runtime,
      buildOwnerBroadcastComposeMenu(language, draft),
    );
    if (messageId) {
      setTimeout(() => {
        void context.api.deleteMessage(context.chat!.id, messageId).catch(() => undefined);
      }, 3000);
    }
    return true;
  }

  if (draft.inputMode === "caption" && context.message?.text) {
    draft.caption = context.message.text.trim();
    draft.inputMode = null;
    draft.step = "compose";
    await saveOwnerBroadcastDraft(deps.redis, runtime.botRecord.id, context.from.id, draft);
    await deps.showDashboard(
      context,
      runtime,
      buildOwnerBroadcastComposeMenu(language, draft),
    );
    if (messageId) {
      setTimeout(() => {
        void context.api.deleteMessage(context.chat!.id, messageId).catch(() => undefined);
      }, 3000);
    }
    return true;
  }

  if (draft.contentKind === "TEXT" && context.message?.text) {
    draft.text = context.message.text;
    draft.step = "compose";
    await saveOwnerBroadcastDraft(deps.redis, runtime.botRecord.id, context.from.id, draft);
    await deps.showDashboard(
      context,
      runtime,
      buildOwnerBroadcastComposeMenu(language, draft),
    );
    if (messageId) {
      setTimeout(() => {
        void context.api.deleteMessage(context.chat!.id, messageId).catch(() => undefined);
      }, 3000);
    }
    return true;
  }

  if (
    draft.contentKind &&
    draft.contentKind !== "TEXT" &&
    draft.inputMode !== "buttons" &&
    draft.inputMode !== "caption"
  ) {
    const fileRef = telegramFileRefForKind(context.message, draft.contentKind);
    if (!fileRef) {
      return false;
    }
    try {
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
        fileId: fileRef.fileId,
        declaredKind: draft.contentKind,
        originalName: fileRef.originalName,
      });
      if ("error" in ingested) {
        await deps.showDashboard(
          context,
          runtime,
          {
            ...buildOwnerBroadcastComposeMenu(language, draft),
            text: `${buildOwnerBroadcastComposeMenu(language, draft).text}\n\n${translate(language, "ownerBroadcast.invalidInput")}`,
          },
        );
        if (messageId) {
          setTimeout(() => {
            void context.api.deleteMessage(context.chat!.id, messageId).catch(() => undefined);
          }, 3000);
        }
        return true;
      }
      draft.mediaAssetId = ingested.mediaAssetId;
      if (context.message.caption?.trim()) {
        draft.caption = context.message.caption.trim();
      }
      draft.inputMode = null;
      draft.step = "compose";
      await saveOwnerBroadcastDraft(deps.redis, runtime.botRecord.id, context.from.id, draft);
      await deps.showDashboard(
        context,
        runtime,
        buildOwnerBroadcastComposeMenu(language, draft),
      );
      if (messageId) {
        setTimeout(() => {
          void context.api.deleteMessage(context.chat!.id, messageId).catch(() => undefined);
        }, 3000);
      }
      return true;
    } catch {
      return false;
    }
  }

  return false;
}

export function ownerBroadcastBotToken(runtime: ManagedBotRuntime, env: Env): string {
  return decryptToken(runtime.botRecord.tokenEncrypted, env.ENCRYPTION_KEY);
}
