import type { Context } from "grammy";
import type { PrismaClient, SupportedLanguage } from "@prisma/client";
import type { Redis } from "ioredis";
import { translate } from "../../localization/localization.service.js";
import {
  getDashboardState,
  saveDashboardState,
} from "../../bots/dashboard-state.js";
import type { ManagedBotRuntime } from "../../bots/bot-runtime-manager.js";
import {
  buildBroadcastInputFile,
  buildBroadcastLinkKeyboard,
} from "../send-delivery.js";
import { absolutePathForKey } from "../media-storage.js";
import type { Env } from "../../../config/env.js";
import { dashboardMessageOptions } from "../../bots/platform-menu.js";
import {
  buildOwnerBroadcastButtonHelp,
  buildOwnerBroadcastResultsMenu,
  buildOwnerPreviewKeyboard,
  buildOwnerBroadcastPromptBackKeyboard,
} from "./menu.js";
import type { OwnerBroadcastDraft, OwnerBroadcastPanelSurface } from "./state.js";
import { hasPublishableContent } from "./state.js";

function isTransientTelegramError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  const message = error.message.toLowerCase();
  return (
    message.includes("timeout") ||
    message.includes("network") ||
    message.includes("econnreset") ||
    message.includes("too many requests") ||
    message.includes("retry after")
  );
}

async function safeDeleteMessage(
  context: Context,
  chatId: number,
  messageId: number,
): Promise<void> {
  await context.api.deleteMessage(chatId, messageId).catch(() => undefined);
}

async function replacePanelMessage(
  context: Context,
  redis: Redis,
  botId: string,
  ownerTelegramId: number,
  oldMessageId: number | null,
  sendNew: () => Promise<{ message_id: number }>,
  surface: OwnerBroadcastPanelSurface,
): Promise<{ messageId: number; surface: OwnerBroadcastPanelSurface } | null> {
  try {
    const sent = await sendNew();
    await saveDashboardState(redis, botId, ownerTelegramId, {
      chatId: context.chat!.id,
      messageId: sent.message_id,
    });
    if (oldMessageId !== null && oldMessageId !== sent.message_id) {
      await safeDeleteMessage(context, context.chat!.id, oldMessageId);
    }
    return { messageId: sent.message_id, surface };
  } catch (error) {
    if (isTransientTelegramError(error)) {
      return null;
    }
    throw error;
  }
}

async function persistPanelRef(
  redis: Redis,
  botId: string,
  ownerTelegramId: number,
  chatId: number,
  messageId: number,
): Promise<void> {
  await saveDashboardState(redis, botId, ownerTelegramId, { chatId, messageId });
}

export async function syncOwnerBroadcastPanel(input: {
  context: Context;
  runtime: ManagedBotRuntime;
  prisma: PrismaClient;
  redis: Redis;
  env: Env;
  language: SupportedLanguage;
  draft: OwnerBroadcastDraft;
  errorLine?: string;
}): Promise<OwnerBroadcastDraft> {
  const { context, runtime, draft } = input;
  if (!context.from || !context.chat) {
    return draft;
  }
  const botId = runtime.botRecord.id;
  const ownerId = context.from.id;
  const dashboard = await getDashboardState(input.redis, botId, ownerId);
  const oldMessageId = dashboard?.chatId === context.chat.id ? dashboard.messageId : null;

  const prefix = input.errorLine ? `${input.errorLine}\n\n` : "";

  if (draft.inputMode === "buttons") {
    const help = buildOwnerBroadcastButtonHelp(input.language);
    const text = prefix + help.text;
    const keyboard = help.keyboard;
    const next = await showTextPanel(
      context,
      input.redis,
      botId,
      ownerId,
      oldMessageId,
      draft.panelSurface,
      text,
      keyboard,
      help.parseMode === "HTML",
    );
    if (next) {
      return { ...draft, panelSurface: "text" };
    }
    return draft;
  }

  if (draft.inputMode === "media" || draft.step === "awaitMedia") {
    const text =
      prefix + translate(input.language, "ownerBroadcast.sendMediaPrompt");
    const keyboard = buildOwnerBroadcastPromptBackKeyboard(input.language);
    const next = await showTextPanel(
      context,
      input.redis,
      botId,
      ownerId,
      oldMessageId,
      draft.panelSurface,
      text,
      keyboard,
      false,
    );
    if (next) {
      return { ...draft, panelSurface: "text" };
    }
    return draft;
  }

  if (draft.step === "awaitPost") {
    const text = prefix + translate(input.language, "ownerBroadcast.sendPostPrompt");
    const keyboard = buildOwnerBroadcastPromptBackKeyboard(input.language);
    const next = await showTextPanel(
      context,
      input.redis,
      botId,
      ownerId,
      oldMessageId,
      draft.panelSurface,
      text,
      keyboard,
      false,
    );
    if (next) {
      return { ...draft, panelSurface: "text" };
    }
    return draft;
  }

  if (draft.step === "preview" && hasPublishableContent(draft)) {
    const markup = buildOwnerPreviewKeyboard(input.language, draft);

    if (draft.contentKind === "TEXT" && draft.text) {
      const text = prefix + draft.text;
      if (draft.panelSurface === "text" && oldMessageId !== null) {
        try {
          await context.api.editMessageText(context.chat.id, oldMessageId, text, {
            reply_markup: markup,
          });
          return { ...draft, panelSurface: "text" };
        } catch (error) {
          if (isTransientTelegramError(error)) {
            return draft;
          }
          if (!isMessageCantEdit(error)) {
            throw error;
          }
        }
      }
      const replaced = await replacePanelMessage(
        context,
        input.redis,
        botId,
        ownerId,
        oldMessageId,
        () =>
          context.api.sendMessage(context.chat!.id, text, {
            reply_markup: markup,
          }),
        "text",
      );
      if (replaced) {
        return { ...draft, panelSurface: "text" };
      }
      return draft;
    }

    if (draft.mediaAssetId && draft.contentKind && draft.contentKind !== "TEXT") {
      const asset = await input.prisma.broadcastMediaAsset.findUnique({
        where: { id: draft.mediaAssetId },
        select: { storageKey: true, originalName: true, contentKind: true },
      });
      if (!asset) {
        return draft;
      }
      const path = absolutePathForKey(input.env.BROADCAST_MEDIA_DIR, asset.storageKey);
      const file = buildBroadcastInputFile(path, asset.originalName);
      const caption = prefix + (draft.caption?.trim() ?? "");
      const extra = { caption: caption || undefined, reply_markup: markup };

      if (
        draft.panelSurface === "media" &&
        oldMessageId !== null &&
        asset.contentKind === draft.contentKind
      ) {
        try {
          if (draft.contentKind === "PHOTO") {
            await context.api.editMessageMedia(context.chat.id, oldMessageId, {
              type: "photo",
              media: file,
              ...extra,
            });
          } else if (draft.contentKind === "VIDEO") {
            await context.api.editMessageMedia(context.chat.id, oldMessageId, {
              type: "video",
              media: file,
              ...extra,
            });
          } else if (draft.contentKind === "ANIMATION") {
            await context.api.editMessageMedia(context.chat.id, oldMessageId, {
              type: "animation",
              media: file,
              ...extra,
            });
          }
          return { ...draft, panelSurface: "media" };
        } catch (error) {
          if (isTransientTelegramError(error)) {
            return draft;
          }
        }
      }

      const replaced = await replacePanelMessage(
        context,
        input.redis,
        botId,
        ownerId,
        oldMessageId,
        async () => {
          if (draft.contentKind === "PHOTO") {
            return context.api.sendPhoto(context.chat!.id, file, extra);
          }
          if (draft.contentKind === "VIDEO") {
            return context.api.sendVideo(context.chat!.id, file, extra);
          }
          return context.api.sendAnimation(context.chat!.id, file, extra);
        },
        "media",
      );
      if (replaced) {
        return { ...draft, panelSurface: "media" };
      }
    }
  }

  return draft;
}

function isMessageCantEdit(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return true;
  }
  const message = error.message.toLowerCase();
  return (
    message.includes("there is no text") ||
    message.includes("message can't be edited") ||
    message.includes("message to edit not found") ||
    message.includes("wrong type")
  );
}

async function showTextPanel(
  context: Context,
  redis: Redis,
  botId: string,
  ownerTelegramId: number,
  oldMessageId: number | null,
  panelSurface: OwnerBroadcastPanelSurface | undefined,
  text: string,
  keyboard: ReturnType<typeof buildOwnerBroadcastPromptBackKeyboard>,
  html: boolean,
): Promise<boolean> {
  const extra = {
    reply_markup: keyboard,
    ...(html ? { parse_mode: "HTML" as const } : {}),
  };
  if (panelSurface === "text" && oldMessageId !== null) {
    try {
      await context.api.editMessageText(context.chat!.id, oldMessageId, text, extra);
      return true;
    } catch (error) {
      if (isTransientTelegramError(error)) {
        return false;
      }
      if (!isMessageCantEdit(error)) {
        throw error;
      }
    }
  }
  try {
    const sent = await context.api.sendMessage(context.chat!.id, text, extra);
    await persistPanelRef(redis, botId, ownerTelegramId, context.chat!.id, sent.message_id);
    if (oldMessageId !== null && oldMessageId !== sent.message_id) {
      await safeDeleteMessage(context, context.chat!.id, oldMessageId);
    }
    return true;
  } catch (error) {
    if (isTransientTelegramError(error)) {
      return false;
    }
    throw error;
  }
}

/** Always replaces the dashboard with a text results view (safe after media preview). */
export async function showOwnerBroadcastResultsPanel(input: {
  context: Context;
  runtime: ManagedBotRuntime;
  redis: Redis;
  language: SupportedLanguage;
  summaryText: string;
}): Promise<boolean> {
  if (!input.context.from || !input.context.chat) {
    return false;
  }
  const botId = input.runtime.botRecord.id;
  const ownerId = input.context.from.id;
  const view = buildOwnerBroadcastResultsMenu(input.language, input.summaryText);
  const dashboard = await getDashboardState(input.redis, botId, ownerId);
  const oldMessageId =
    dashboard?.chatId === input.context.chat.id ? dashboard.messageId : null;
  try {
    const sent = await input.context.api.sendMessage(
      input.context.chat.id,
      view.text,
      dashboardMessageOptions(view),
    );
    await persistPanelRef(
      input.redis,
      botId,
      ownerId,
      input.context.chat.id,
      sent.message_id,
    );
    if (oldMessageId !== null && oldMessageId !== sent.message_id) {
      await safeDeleteMessage(input.context, input.context.chat.id, oldMessageId);
    }
    return true;
  } catch (error) {
    if (isTransientTelegramError(error)) {
      return false;
    }
    throw error;
  }
}
