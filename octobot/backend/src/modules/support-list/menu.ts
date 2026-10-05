import type { SupportListSettings } from "@prisma/client";
import { SupportedLanguage } from "@prisma/client";
import { InlineKeyboard } from "grammy";
import { buildChannelAddLink } from "../channels/channel-add-link.js";
import { translate } from "../localization/localization.service.js";
import type { DashboardView } from "../bots/platform-menu.js";
import { MAX_ACCEPTED_CHANNELS, TIME_ZONE_PRESETS } from "./constants.js";
import type { DisableFlags, DisableReasonCode } from "./eligibility.js";
import { disableReasonCodes } from "./eligibility.js";
import type { MembershipPageItem } from "./membership.service.js";

export type ListScope = "m" | "a" | "p" | "r";

function back(language: SupportedLanguage, data: string): InlineKeyboard {
  return new InlineKeyboard().text(
    translate(language, "menu.back"),
    data,
  );
}

export function buildSupportListHome(
  settings: Pick<SupportListSettings, "listName" | "contactUrl">,
  language: SupportedLanguage,
  isOwner: boolean,
  acceptedCount: number,
): DashboardView {
  const keyboard = new InlineKeyboard()
    .text(translate(language, "supportList.addChannel"), "sl:add")
    .text(translate(language, "supportList.myChannels"), "sl:mine:0")
    .row()
    .text(translate(language, "supportList.pending"), "sl:pend:0")
    .text(translate(language, "menu.language"), "sl:lang")
    .row();
  if (settings.contactUrl) {
    keyboard.url(
      translate(language, "supportList.contactAdmin"),
      settings.contactUrl,
    );
  } else {
    keyboard.text(
      translate(language, "supportList.contactAdmin"),
      "sl:contact",
    );
  }
  if (isOwner) {
    keyboard.row().text(translate(language, "supportList.admin"), "sl:admin");
  }
  return {
    text: `${translate(language, "supportList.welcome", {
      listName: settings.listName,
    })}\n\n${translate(language, "supportList.home", {
      listName: settings.listName,
      count: acceptedCount,
      max: MAX_ACCEPTED_CHANNELS,
    })}`,
    keyboard,
  };
}

export function buildSupportLanguageMenu(
  language: SupportedLanguage,
): DashboardView {
  return {
    text: translate(language, "language.select"),
    keyboard: new InlineKeyboard()
      .text(translate(language, "language.arabic"), "sl:lang:AR")
      .text(translate(language, "language.english"), "sl:lang:EN")
      .row()
      .text(translate(language, "menu.back"), "sl:home"),
  };
}

export function buildSupportAddChannel(
  language: SupportedLanguage,
  botUsername: string,
): DashboardView {
  return {
    text: translate(language, "supportList.addInstructions"),
    keyboard: new InlineKeyboard()
      .url(
        translate(language, "channelLink.addBotButton"),
        buildChannelAddLink(botUsername),
      )
      .row()
      .text(translate(language, "menu.back"), "sl:home"),
  };
}

export function buildPrompt(
  language: SupportedLanguage,
  text: string,
  backCallback = "sl:home",
): DashboardView {
  return {
    text,
    keyboard: back(language, backCallback),
  };
}

function statusLabel(
  language: SupportedLanguage,
  item: MembershipPageItem,
): string {
  if (item.acceptanceStatus === "PENDING") {
    return translate(language, "supportList.statusPending");
  }
  if (disableReasonCodes(item.flags).length > 0) {
    return translate(language, "supportList.statusDisabled");
  }
  return translate(language, "supportList.statusAccepted");
}

export function buildMembershipList(input: {
  language: SupportedLanguage;
  title: string;
  items: MembershipPageItem[];
  page: number;
  pages: number;
  scope: ListScope;
  backCallback: string;
}): DashboardView {
  const keyboard = new InlineKeyboard();
  if (input.items.length === 0) {
    keyboard.text(translate(input.language, "menu.back"), input.backCallback);
    return {
      text: `${input.title}\n\n${translate(input.language, "supportList.empty")}`,
      keyboard,
    };
  }
  for (const item of input.items) {
    keyboard
      .text(
        `${item.title} · ${statusLabel(input.language, item)}`.slice(0, 64),
        `sl:item:${item.id}:${input.page}:${input.scope}`,
      )
      .row();
  }
  if (input.pages > 1) {
    if (input.page > 0) {
      keyboard.text(
        translate(input.language, "management.previous"),
        `sl:list:${input.scope}:${input.page - 1}`,
      );
    }
    if (input.page + 1 < input.pages) {
      keyboard.text(
        translate(input.language, "management.next"),
        `sl:list:${input.scope}:${input.page + 1}`,
      );
    }
    keyboard.row();
  }
  keyboard.text(translate(input.language, "menu.back"), input.backCallback);
  return { text: input.title, keyboard };
}

export function buildMembershipDetail(input: {
  language: SupportedLanguage;
  title: string;
  status: string;
  membershipId: string;
  page: number;
  scope: ListScope;
  flags: DisableFlags;
  pendingReview: boolean;
}): DashboardView {
  const keyboard = new InlineKeyboard();
  const suffix = `${input.membershipId}:${input.page}:${input.scope}`;
  if (input.pendingReview) {
    keyboard
      .text(translate(input.language, "supportList.accept"), `sl:acc:${input.membershipId}`)
      .text(translate(input.language, "supportList.reject"), `sl:rej:${input.membershipId}`)
      .row();
  }
  keyboard.text(translate(input.language, "supportList.view"), `sl:view:${suffix}`).row();
  if (!input.pendingReview) {
    keyboard
      .text(translate(input.language, "supportList.activate"), `sl:on:${suffix}`)
      .text(translate(input.language, "supportList.deactivate"), `sl:off:${suffix}`)
      .row();
  }
  keyboard.text(translate(input.language, "supportList.delete"), `sl:del:${suffix}`).row();
  if (disableReasonCodes(input.flags).length > 0) {
    keyboard.text(translate(input.language, "supportList.why"), `sl:why:${suffix}`).row();
  }
  keyboard.text(
    translate(input.language, "menu.back"),
    `sl:list:${input.scope}:${input.page}`,
  );
  return {
    text: translate(input.language, "supportList.detail", {
      title: input.title,
      status: input.status,
    }),
    keyboard,
  };
}

export function buildDeleteConfirm(
  language: SupportedLanguage,
  title: string,
  membershipId: string,
  page: number,
  scope: ListScope,
): DashboardView {
  return {
    text: translate(language, "supportList.confirmDelete", { title }),
    keyboard: new InlineKeyboard()
      .text(
        translate(language, "management.confirm"),
        `sl:yes:${membershipId}:${page}:${scope}`,
      )
      .text(translate(language, "management.cancel"), `sl:item:${membershipId}:${page}:${scope}`)
      .row(),
  };
}

export function buildReasonView(input: {
  language: SupportedLanguage;
  title: string;
  flags: DisableFlags;
  membershipId: string;
  page: number;
  scope: ListScope;
}): DashboardView {
  const lines = [
    translate(input.language, "supportList.reasonTitle", { title: input.title }),
  ];
  for (const reason of disableReasonCodes(input.flags) as DisableReasonCode[]) {
    if (reason === "participant") {
      lines.push(translate(input.language, "supportList.reasonParticipant"));
    } else if (reason === "admin") {
      lines.push(
        translate(input.language, "supportList.reasonAdmin", {
          reason: input.flags.adminDisableReason ?? "—",
        }),
      );
    } else if (reason === "permissions") {
      lines.push(translate(input.language, "supportList.reasonPermissions"));
    } else {
      lines.push(translate(input.language, "supportList.reasonInvite"));
    }
  }
  return {
    text: lines.join("\n"),
    keyboard: back(
      input.language,
      `sl:item:${input.membershipId}:${input.page}:${input.scope}`,
    ),
  };
}

export function buildAdminHome(
  language: SupportedLanguage,
  settings: SupportListSettings,
  acceptedCount: number,
): DashboardView {
  return {
    text: translate(language, "supportList.home", {
      listName: settings.listName,
      count: acceptedCount,
      max: MAX_ACCEPTED_CHANNELS,
    }),
    keyboard: new InlineKeyboard()
      .text(translate(language, "supportList.listName"), "sl:name")
      .text(translate(language, "supportList.acceptance"), "sl:mode")
      .row()
      .text(translate(language, "supportList.requests"), "sl:reqs:0")
      .text(translate(language, "supportList.allChannels"), "sl:all:0")
      .row()
      .text(translate(language, "supportList.format"), "sl:fmt")
      .text(translate(language, "supportList.preview"), "sl:preview")
      .row()
      .text(translate(language, "supportList.schedule"), "sl:sched")
      .text(translate(language, "supportList.contactLink"), "sl:link")
      .row()
      .text(translate(language, "menu.back"), "sl:home"),
  };
}

export function buildAcceptanceMenu(
  language: SupportedLanguage,
): DashboardView {
  return {
    text: translate(language, "supportList.acceptance"),
    keyboard: new InlineKeyboard()
      .text(translate(language, "supportList.manual"), "sl:mode:MANUAL")
      .row()
      .text(translate(language, "supportList.auto"), "sl:mode:AUTO")
      .row()
      .text(translate(language, "menu.back"), "sl:admin"),
  };
}

export function buildFormatMenu(language: SupportedLanguage): DashboardView {
  return {
    text: translate(language, "supportList.format"),
    keyboard: new InlineKeyboard()
      .text(translate(language, "supportList.textFormat"), "sl:fmt:TEXT")
      .row()
      .text(translate(language, "supportList.buttonFormat"), "sl:fmt:BUTTONS")
      .row()
      .text(translate(language, "menu.back"), "sl:admin"),
  };
}

export function buildScheduleMenu(input: {
  language: SupportedLanguage;
  timeZone: string;
  modeLabel: string;
  retention: number;
  publishing: boolean;
  next: string;
}): DashboardView {
  return {
    text: translate(input.language, "supportList.scheduleTitle", {
      timeZone: input.timeZone,
      mode: input.modeLabel,
      retention: input.retention,
      state: translate(
        input.language,
        input.publishing
          ? "supportList.publishingOn"
          : "supportList.publishingOff",
      ),
      next: input.next,
    }),
    keyboard: new InlineKeyboard()
      .text(
        translate(
          input.language,
          input.publishing ? "supportList.pause" : "supportList.resume",
        ),
        input.publishing ? "sl:pause" : "sl:resume",
      )
      .row()
      .text(translate(input.language, "supportList.schedule"), "sl:times")
      .text(translate(input.language, "supportList.timeZone"), "sl:tz")
      .row()
      .text(translate(input.language, "supportList.defaultMode"), "sl:default")
      .row()
      .text(translate(input.language, "menu.back"), "sl:admin"),
  };
}

export function buildTimeZoneMenu(language: SupportedLanguage): DashboardView {
  const keyboard = new InlineKeyboard();
  for (const zone of TIME_ZONE_PRESETS) {
    keyboard.text(zone, `sl:tzset:${zone}`).row();
  }
  keyboard.text(translate(language, "menu.back"), "sl:sched");
  return {
    text: translate(language, "supportList.sendTimeZone"),
    keyboard,
  };
}

export function buildRequestKeyboard(
  language: SupportedLanguage,
  membershipId: string,
  url: string | null,
): InlineKeyboard {
  const keyboard = new InlineKeyboard()
    .text(translate(language, "supportList.accept"), `sl:acc:${membershipId}`)
    .text(translate(language, "supportList.reject"), `sl:rej:${membershipId}`);
  if (url) {
    keyboard.row().url(translate(language, "supportList.view"), url);
  }
  return keyboard;
}
