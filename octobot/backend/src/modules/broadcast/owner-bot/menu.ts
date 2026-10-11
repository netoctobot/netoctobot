import { InlineKeyboard } from "grammy";
import type { SupportedLanguage } from "@prisma/client";
import { translate } from "../../localization/localization.service.js";
import type { DashboardView } from "../../bots/platform-menu.js";
import type { OwnerBroadcastDraft } from "./state.js";
import { escapeTelegramHtml } from "./html.js";

const KINDS = ["TEXT", "PHOTO", "VIDEO", "AUDIO", "VOICE", "DOCUMENT", "ANIMATION"] as const;

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

export function buildOwnerBroadcastKindMenu(language: SupportedLanguage): DashboardView {
  const keyboard = new InlineKeyboard();
  for (const kind of KINDS) {
    keyboard.text(kind, `owner:bc:kind:${kind}`).row();
  }
  keyboard.text(translate(language, "ownerBroadcast.back"), "owner:bc:back");
  return {
    text: translate(language, "ownerBroadcast.contentKindTitle"),
    keyboard,
  };
}

export function buildOwnerBroadcastComposeMenu(
  language: SupportedLanguage,
  draft: OwnerBroadcastDraft,
): DashboardView {
  const keyboard = new InlineKeyboard();
  if (draft.contentKind === "TEXT") {
    keyboard.text(translate(language, "ownerBroadcast.editText"), "owner:bc:editText");
  } else {
    keyboard
      .text(translate(language, "ownerBroadcast.editCaption"), "owner:bc:editCaption")
      .row();
    if (draft.caption) {
      keyboard.text(translate(language, "ownerBroadcast.removeCaption"), "owner:bc:removeCaption").row();
    }
  }
  const hasButtons = Boolean(draft.linkButtons && draft.linkButtons.length > 0);
  keyboard
    .text(
      hasButtons
        ? translate(language, "ownerBroadcast.editButtons")
        : translate(language, "ownerBroadcast.addButtons"),
      "owner:bc:editButtons",
    )
    .row();
  if (hasButtons) {
    keyboard.text(translate(language, "ownerBroadcast.removeButtons"), "owner:bc:removeButtons").row();
  }
  keyboard
    .text(translate(language, "ownerBroadcast.preview"), "owner:bc:preview")
    .row()
    .text(translate(language, "ownerBroadcast.back"), "owner:bc:back");
  const summary = draft.contentKind === "TEXT" ? draft.text ?? "" : draft.caption ?? "";
  return {
    text: `${translate(language, "ownerBroadcast.composeTitle")}\n\n${summary || "—"}`,
    keyboard,
  };
}

export function buildOwnerBroadcastButtonHelp(language: SupportedLanguage): DashboardView {
  const example = escapeTelegramHtml(
    "قناة أولى - https://example.com | قناة ثانية - https://example.org\nموقعنا - https://example.net - style:blue",
  );
  const text = `${translate(language, "ownerBroadcast.buttonHelp")}\n\n<pre>${example}</pre>`;
  return {
    text,
    keyboard: new InlineKeyboard().text(
      translate(language, "ownerBroadcast.back"),
      "owner:bc:back",
    ),
    parseMode: "HTML",
  };
}

export function buildOwnerBroadcastPreviewMenu(
  language: SupportedLanguage,
  summaryText: string,
): DashboardView {
  return {
    text: `${translate(language, "ownerBroadcast.previewTitle")}\n\n${summaryText}\n\n${translate(language, "ownerBroadcast.preliminaryNote")}`,
    keyboard: new InlineKeyboard()
      .text(translate(language, "ownerBroadcast.publishNow"), "owner:bc:publish")
      .row()
      .text(translate(language, "ownerBroadcast.back"), "owner:bc:back"),
  };
}

export function buildOwnerBroadcastResultsMenu(
  language: SupportedLanguage,
  summaryText: string,
): DashboardView {
  return {
    text: `${translate(language, "ownerBroadcast.resultsTitle")}\n\n${summaryText}`,
    keyboard: new InlineKeyboard().text(
      translate(language, "ownerBroadcast.back"),
      "owner:bc:home",
    ),
  };
}
