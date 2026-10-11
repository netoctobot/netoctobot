import { createReadStream } from "node:fs";
import { InlineKeyboard, InputFile, type Api } from "grammy";
import type { PrismaClient, BroadcastContentKind } from "@prisma/client";
import type { LinkButtonMatrix } from "./content.js";
import { absolutePathForKey, sanitizeBroadcastFilename } from "./media-storage.js";

export interface SendCampaignContent {
  contentKind: BroadcastContentKind;
  text: string;
  caption: string | null;
  linkButtons: LinkButtonMatrix | null;
  mediaAsset: {
    id: string;
    storageKey: string;
    contentKind: BroadcastContentKind;
    originalName: string;
  } | null;
}

export type SendOutcome =
  | { status: "sent"; messageId: number; chatId: number }
  | { status: "uncertain"; messageId?: number; chatId?: number }
  | { status: "failed"; reason: string; cause?: unknown };

export function buildBroadcastLinkKeyboard(
  linkButtons: LinkButtonMatrix | null,
): InlineKeyboard | undefined {
  if (!linkButtons || linkButtons.length === 0) {
    return undefined;
  }
  const keyboard = new InlineKeyboard();
  for (let rowIndex = 0; rowIndex < linkButtons.length; rowIndex += 1) {
    const row = linkButtons[rowIndex];
    for (const button of row) {
      keyboard.url(button.text, button.url);
      if (button.style === "primary") {
        keyboard.primary();
      } else if (button.style === "success") {
        keyboard.success();
      } else if (button.style === "danger") {
        keyboard.danger();
      }
    }
    if (rowIndex < linkButtons.length - 1) {
      keyboard.row();
    }
  }
  return keyboard;
}

export function buildBroadcastInputFile(filePath: string, originalName: string): InputFile {
  return new InputFile(createReadStream(filePath), sanitizeBroadcastFilename(originalName));
}

async function sendWithApi(
  api: Api,
  chatId: number,
  content: SendCampaignContent,
  filePath: string | null,
  fileId: string | null,
  uploadFilename: string | null,
): Promise<{ message_id: number }> {
  const markup = buildBroadcastLinkKeyboard(content.linkButtons);
  const extra = markup ? { reply_markup: markup } : {};
  const caption = content.caption ?? undefined;

  if (content.contentKind === "TEXT") {
    return api.sendMessage(chatId, content.text, extra);
  }

  if (fileId) {
    switch (content.contentKind) {
      case "PHOTO":
        return api.sendPhoto(chatId, fileId, { caption, ...extra });
      case "VIDEO":
        return api.sendVideo(chatId, fileId, { caption, ...extra });
      case "AUDIO":
        return api.sendAudio(chatId, fileId, { caption, ...extra });
      case "VOICE":
        return api.sendVoice(chatId, fileId, { caption, ...extra });
      case "ANIMATION":
        return api.sendAnimation(chatId, fileId, { caption, ...extra });
      default:
        return api.sendDocument(chatId, fileId, { caption, ...extra });
    }
  }

  if (!filePath || !uploadFilename) {
    throw new Error("missing_media");
  }
  const input = buildBroadcastInputFile(filePath, uploadFilename);
  switch (content.contentKind) {
    case "PHOTO":
      return api.sendPhoto(chatId, input, { caption, ...extra });
    case "VIDEO":
      return api.sendVideo(chatId, input, { caption, ...extra });
    case "AUDIO":
      return api.sendAudio(chatId, input, { caption, ...extra });
    case "VOICE":
      return api.sendVoice(chatId, input, { caption, ...extra });
    case "ANIMATION":
      return api.sendAnimation(chatId, input, { caption, ...extra });
    default:
      return api.sendDocument(chatId, input, { caption, ...extra });
  }
}

export async function persistSentDelivery(input: {
  prisma: PrismaClient;
  deliveryId: string;
  chatId: number;
  messageId: number;
  mediaAssetId: string | null;
  botId: string;
  telegramFileId?: string;
  telegramFileUniqueId?: string;
}): Promise<"ok" | "uncertain"> {
  try {
    await input.prisma.$transaction(async (tx) => {
      await tx.broadcastDelivery.updateMany({
        where: { id: input.deliveryId, status: "PENDING" },
        data: {
          status: "SENT",
          telegramMessageId: BigInt(input.messageId),
          recipientTelegramChatId: BigInt(input.chatId),
        },
      });
      await tx.broadcastDeliveryMessage.create({
        data: {
          deliveryId: input.deliveryId,
          telegramMessageId: BigInt(input.messageId),
          sortOrder: 0,
        },
      });
    });
  } catch {
    return "uncertain";
  }

  if (input.mediaAssetId && input.telegramFileId) {
    try {
      await input.prisma.broadcastMediaBotFile.upsert({
        where: {
          mediaAssetId_botId: {
            mediaAssetId: input.mediaAssetId,
            botId: input.botId,
          },
        },
        create: {
          mediaAssetId: input.mediaAssetId,
          botId: input.botId,
          telegramFileId: input.telegramFileId,
          telegramFileUniqueId: input.telegramFileUniqueId ?? null,
        },
        update: {
          telegramFileId: input.telegramFileId,
          telegramFileUniqueId: input.telegramFileUniqueId ?? null,
        },
      });
    } catch {
      // Optional cache; send already succeeded.
    }
  }
  return "ok";
}

export async function executeBroadcastSend(input: {
  prisma: PrismaClient;
  api: Api;
  mediaRoot: string;
  deliveryId: string;
  botId: string;
  chatId: number;
  content: SendCampaignContent;
}): Promise<SendOutcome> {
  let cachedFileId: string | null = null;
  if (input.content.mediaAsset) {
    const cached = await input.prisma.broadcastMediaBotFile.findUnique({
      where: {
        mediaAssetId_botId: {
          mediaAssetId: input.content.mediaAsset.id,
          botId: input.botId,
        },
      },
      select: { telegramFileId: true },
    });
    cachedFileId = cached?.telegramFileId ?? null;
  }

  const filePath =
    input.content.mediaAsset && !cachedFileId
      ? absolutePathForKey(input.mediaRoot, input.content.mediaAsset.storageKey)
      : null;

  let sent: { message_id: number; photo?: Array<{ file_id: string; file_unique_id: string }>; video?: { file_id: string; file_unique_id: string }; document?: { file_id: string; file_unique_id: string }; audio?: { file_id: string; file_unique_id: string }; voice?: { file_id: string; file_unique_id: string }; animation?: { file_id: string; file_unique_id: string } };
  try {
    const uploadFilename = input.content.mediaAsset?.originalName ?? null;
    sent = await sendWithApi(
      input.api,
      input.chatId,
      input.content,
      filePath,
      cachedFileId,
      uploadFilename,
    );
  } catch (error) {
    const reason = error instanceof Error ? error.message : "send_failed";
    return { status: "failed", reason, cause: error };
  }

  const fileRef =
    sent.photo?.[0] ??
    sent.video ??
    sent.document ??
    sent.audio ??
    sent.voice ??
    sent.animation;

  const persist = await persistSentDelivery({
    prisma: input.prisma,
    deliveryId: input.deliveryId,
    chatId: input.chatId,
    messageId: sent.message_id,
    mediaAssetId: input.content.mediaAsset?.id ?? null,
    botId: input.botId,
    telegramFileId: fileRef?.file_id,
    telegramFileUniqueId: fileRef?.file_unique_id,
  });

  if (persist === "uncertain") {
    return { status: "uncertain", messageId: sent.message_id, chatId: input.chatId };
  }
  return { status: "sent", messageId: sent.message_id, chatId: input.chatId };
}
