import { InlineKeyboard } from "grammy";
import type { SupportedLanguage } from "@prisma/client";
import { translate } from "../../localization/localization.service.js";
import type { DashboardView } from "../../bots/platform-menu.js";
import type { OwnerBroadcastDraft } from "./state.js";
import { escapeTelegramHtml } from "./html.js";
import { buildBroadcastLinkKeyboard } from "../send-delivery.js";

export function buildOwnerBroadcastAudienceMenu(language: SupportedLanguage): DashboardView {
  return {
    text: translate(language, "ownerBroadcast.audienceTitle"),
    keyboard: new InlineKeyboard()
      .text(translate(language, "ownerBroadcast.channels"), "owner:bc:aud:channels")
      .text(translate(language, "ownerBroadcast.users"), "owner:bc:aud:users")
      .row()
      .text(translate(language, "ownerBroadcast.both"), "owner:bc:aud:both")
      .row()
      .text(translate(language, "ownerBroadcast.back"), "owner:bc:home"),
  };
}

export function buildOwnerBroadcastPromptBackKeyboard(
  language: SupportedLanguage,
): InlineKeyboard {
  return new InlineKeyboard().text(translate(language, "ownerBroadcast.back"), "owner:bc:back");
}

export function buildOwnerPreviewKeyboard(
  language: SupportedLanguage,
  draft: OwnerBroadcastDraft,
): InlineKeyboard {
  const keyboard =
    buildBroadcastLinkKeyboard(draft.linkButtons ?? null) ?? new InlineKeyboard();
  const hasMedia = Boolean(draft.mediaAssetId);
  keyboard
    .row()
    .text(
      hasMedia
        ? translate(language, "ownerBroadcast.changeMedia")
        : translate(language, "ownerBroadcast.addMedia"),
      "owner:bc:media",
    )
    .row();
  const hasButtons = Boolean(draft.linkButtons && draft.linkButtons.length > 0);
  keyboard.text(
    hasButtons
      ? translate(language, "ownerBroadcast.editButtons")
      : translate(language, "ownerBroadcast.addButtons"),
    "owner:bc:buttons",
  );
  if (hasButtons) {
    keyboard.text(translate(language, "ownerBroadcast.removeButtons"), "owner:bc:removeButtons");
  }
  keyboard.row();
  if (hasMedia && draft.caption?.trim()) {
    keyboard.text(translate(language, "ownerBroadcast.removeText"), "owner:bc:removeText");
    keyboard.row();
  }
  keyboard
    .text(translate(language, "ownerBroadcast.publishNow"), "owner:bc:publish")
    .row()
    .text(translate(language, "ownerBroadcast.back"), "owner:bc:back");
  return keyboard;
}

export function buildOwnerBroadcastButtonHelp(language: SupportedLanguage): DashboardView {
  const example = escapeTelegramHtml(
    "قناة أولى - https://example.com | قناة ثانية - https://example.org\nموقعنا - https://example.net - style:blue",
  );
  const text = `${translate(language, "ownerBroadcast.buttonHelp")}\n\n<pre>${example}</pre>`;
  return {
    text,
    keyboard: buildOwnerBroadcastPromptBackKeyboard(language),
    parseMode: "HTML",
  };
}

export function buildOwnerBroadcastResultsMenu(
  language: SupportedLanguage,
  summaryText: string,
): DashboardView {
  return {
    text: `${translate(language, "ownerBroadcast.resultsTitle")}\n\n${summaryText}`,
    keyboard: new InlineKeyboard()
      .text(translate(language, "ownerBroadcast.broadcast"), "owner:bc:start")
      .row()
      .text(translate(language, "ownerBroadcast.back"), "owner:bc:home"),
  };
}
