import {
  BotType,
  type SupportedLanguage,
} from "@prisma/client";
import { InlineKeyboard } from "grammy";
import type { OwnedChannelPage, OwnedChannelSummary } from "../channels/channel-management.service.js";
import { translate } from "../localization/localization.service.js";
import type {
  OwnedBotPage,
  OwnedBotSummary,
} from "./bot-management.service.js";
import type { DashboardView } from "./platform-menu.js";

function stateLabel(
  language: SupportedLanguage,
  isActive: boolean,
): string {
  return translate(
    language,
    isActive ? "management.active" : "management.inactive",
  );
}

function addPagination(
  keyboard: InlineKeyboard,
  language: SupportedLanguage,
  prefix: "manage:b:p" | "manage:c:p",
  page: number,
  pageCount: number,
): void {
  if (pageCount <= 1) {
    return;
  }
  keyboard.row();
  if (page > 0) {
    keyboard.text(
      translate(language, "management.previous"),
      `${prefix}:${page - 1}`,
    );
  }
  if (page + 1 < pageCount) {
    keyboard.text(
      translate(language, "management.next"),
      `${prefix}:${page + 1}`,
    );
  }
}

function botTypeLabel(
  language: SupportedLanguage,
  type: OwnedBotSummary["botType"],
): string {
  return translate(
    language,
    type === BotType.CONTACT_BOT
      ? "botCreation.contactBot"
      : "botCreation.supportListBot",
  );
}

export function buildOwnedBotsMenu(
  language: SupportedLanguage,
  result: OwnedBotPage,
): DashboardView {
  const lines = [translate(language, "management.botsTitle")];
  if (result.items.length === 0) {
    lines.push(translate(language, "management.noBots"));
  } else {
    result.items.forEach((bot, index) => {
      lines.push(
        `${index + 1}. @${bot.botUsername} — ${botTypeLabel(language, bot.botType)} — ${stateLabel(language, bot.isActive)}`,
      );
    });
  }

  const keyboard = new InlineKeyboard();
  result.items.forEach((bot, index) => {
    const number = index + 1;
    keyboard
      .url(
        `${translate(language, "management.view")} ${number}`,
        `https://t.me/${bot.botUsername}`,
      )
      .text(
        `${translate(
          language,
          bot.isActive
            ? "management.deactivate"
            : "management.activate",
        )} ${number}`,
        bot.isActive
          ? `manage:b:d:${bot.id}:${result.page}`
          : `manage:b:a:${bot.id}:${result.page}`,
      )
      .text(
        `${translate(language, "management.delete")} ${number}`,
        `manage:b:x:${bot.id}:${result.page}`,
      )
      .row();
  });
  addPagination(
    keyboard,
    language,
    "manage:b:p",
    result.page,
    result.pageCount,
  );
  keyboard
    .row()
    .text(translate(language, "menu.back"), "menu:home");

  return { text: lines.join("\n"), keyboard };
}

export function buildOwnedChannelsMenu(
  language: SupportedLanguage,
  result: OwnedChannelPage,
): DashboardView {
  const lines = [translate(language, "management.channelsTitle")];
  if (result.items.length === 0) {
    lines.push(translate(language, "management.noChannels"));
  } else {
    result.items.forEach((channel, index) => {
      const name =
        channel.title ??
        (channel.username ? `@${channel.username}` : null) ??
        channel.channelTelegramId.toString();
      lines.push(
        `${index + 1}. ${name} — ${stateLabel(language, channel.isActive)}`,
      );
    });
  }

  const keyboard = new InlineKeyboard();
  result.items.forEach((channel, index) => {
    const number = index + 1;
    if (channel.username) {
      keyboard.url(
        `${translate(language, "management.view")} ${number}`,
        `https://t.me/${channel.username}`,
      );
    } else {
      keyboard.text(
        `${translate(language, "management.view")} ${number}`,
        `manage:c:v:${channel.id}:${result.page}`,
      );
    }
    keyboard
      .text(
        `${translate(
          language,
          channel.isActive
            ? "management.deactivate"
            : "management.activate",
        )} ${number}`,
        channel.isActive
          ? `manage:c:d:${channel.id}:${result.page}`
          : `manage:c:a:${channel.id}:${result.page}`,
      )
      .text(
        `${translate(language, "management.delete")} ${number}`,
        `manage:c:x:${channel.id}:${result.page}`,
      )
      .row();
  });
  addPagination(
    keyboard,
    language,
    "manage:c:p",
    result.page,
    result.pageCount,
  );
  keyboard
    .row()
    .text(translate(language, "menu.back"), "menu:home");

  return { text: lines.join("\n"), keyboard };
}

function botWarningKey(
  bot: OwnedBotSummary,
  action: "deactivate" | "delete",
):
  | "management.contactDeactivateWarning"
  | "management.contactDeleteWarning"
  | "management.supportDeactivateWarning"
  | "management.supportDeleteWarning" {
  const contact = bot.botType === BotType.CONTACT_BOT;
  if (action === "deactivate") {
    return contact
      ? "management.contactDeactivateWarning"
      : "management.supportDeactivateWarning";
  }
  return contact
    ? "management.contactDeleteWarning"
    : "management.supportDeleteWarning";
}

export function buildBotConfirmation(
  language: SupportedLanguage,
  bot: OwnedBotSummary,
  action: "deactivate" | "delete",
  page: number,
): DashboardView {
  return {
    text: translate(language, botWarningKey(bot, action), {
      username: bot.botUsername,
      count: bot.activeChannelCount,
    }),
    keyboard: new InlineKeyboard()
      .text(
        translate(language, "management.confirm"),
        `manage:b:${action === "deactivate" ? "dc" : "xc"}:${bot.id}:${page}`,
      )
      .text(
        translate(language, "management.cancel"),
        `manage:b:p:${page}`,
      ),
  };
}

export function buildChannelConfirmation(
  language: SupportedLanguage,
  channel: OwnedChannelSummary,
  action: "deactivate" | "delete",
  page: number,
): DashboardView {
  const title =
    channel.title ??
    channel.username ??
    channel.channelTelegramId.toString();
  const key =
    action === "delete"
      ? "management.channelDeleteWarning"
      : channel.activeLinkCount > 0
        ? "management.channelDeactivateWarning"
        : "management.channelInactiveLinksWarning";
  return {
    text: translate(language, key, {
      title,
      count: channel.activeLinkCount,
    }),
    keyboard: new InlineKeyboard()
      .text(
        translate(language, "management.confirm"),
        `manage:c:${action === "deactivate" ? "dc" : "xc"}:${channel.id}:${page}`,
      )
      .text(
        translate(language, "management.cancel"),
        `manage:c:p:${page}`,
      ),
  };
}

export function buildPrivateChannelView(
  language: SupportedLanguage,
  channel: OwnedChannelSummary,
  page: number,
): DashboardView {
  return {
    text: translate(language, "management.privateChannelView", {
      title:
        channel.title ?? channel.channelTelegramId.toString(),
      id: channel.channelTelegramId.toString(),
    }),
    keyboard: new InlineKeyboard().text(
      translate(language, "menu.back"),
      `manage:c:p:${page}`,
    ),
  };
}
