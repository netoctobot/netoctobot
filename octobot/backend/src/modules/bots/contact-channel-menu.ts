import { LinkStatus, SupportedLanguage } from "@prisma/client";
import { InlineKeyboard } from "grammy";
import type {
  ManagedBotChannelLink,
  ManagedBotChannelPage,
} from "../channels/bot-channel-management.service.js";
import { translate } from "../localization/localization.service.js";
import { CONTACT_OWNER_HOME } from "./sub-bot-menu.js";
import type { DashboardView } from "./platform-menu.js";

function channelTitle(channel: ManagedBotChannelLink): string {
  return (
    channel.title ??
    (channel.username ? `@${channel.username}` : null) ??
    channel.channelTelegramId.toString()
  );
}

export function buildManagedBotChannelsMenu(
  language: SupportedLanguage,
  result: ManagedBotChannelPage,
): DashboardView {
  const keyboard = new InlineKeyboard();
  for (const link of result.items) {
    const title = channelTitle(link);
    if (link.username) {
      keyboard.url(title, `https://t.me/${link.username}`);
    } else {
      keyboard.text(
        title,
        `owner:c:view:${link.id}:${result.page}`,
      );
    }
    keyboard
      .text(
        link.status === LinkStatus.ACTIVE
          ? translate(language, "management.deactivate")
          : translate(language, "management.activate"),
        link.status === LinkStatus.ACTIVE
          ? `owner:c:d:${link.id}:${result.page}`
          : `owner:c:a:${link.id}:${result.page}`,
      )
      .text(
        translate(language, "management.delete"),
        `owner:c:x:${link.id}:${result.page}`,
      )
      .row();
  }
  if (result.page > 0) {
    keyboard.text(
      translate(language, "management.previous"),
      `owner:channel:list:${result.page - 1}`,
    );
  }
  if (result.page + 1 < result.pageCount) {
    keyboard.text(
      translate(language, "management.next"),
      `owner:channel:list:${result.page + 1}`,
    );
  }
  if (result.page > 0 || result.page + 1 < result.pageCount) {
    keyboard.row();
  }
  keyboard.text(
    translate(language, "menu.back"),
    CONTACT_OWNER_HOME,
  );
  return {
    text:
      result.total === 0
        ? translate(language, "contactOwner.noLinkedChannels")
        : translate(language, "contactOwner.linkedChannelsTitle"),
    keyboard,
  };
}

export function buildManagedLinkConfirmation(
  language: SupportedLanguage,
  link: ManagedBotChannelLink,
  action: "deactivate" | "remove",
  page: number,
): DashboardView {
  return {
    text: translate(
      language,
      action === "deactivate"
        ? "contactOwner.deactivateLinkWarning"
        : "contactOwner.removeLinkWarning",
      { title: channelTitle(link) },
    ),
    keyboard: new InlineKeyboard()
      .text(
        translate(language, "management.confirm"),
        `owner:c:${action === "deactivate" ? "dc" : "xc"}:${link.id}:${page}`,
      )
      .text(
        translate(language, "management.cancel"),
        `owner:channel:list:${page}`,
      ),
  };
}

export function buildManagedLinkDetails(
  language: SupportedLanguage,
  link: ManagedBotChannelLink,
  page: number,
): DashboardView {
  return {
    text: translate(language, "contactOwner.privateChannelLink", {
      title: channelTitle(link),
      id: link.channelTelegramId.toString(),
      status: translate(
        language,
        link.status === LinkStatus.ACTIVE
          ? "management.active"
          : "management.inactive",
      ),
    }),
    keyboard: new InlineKeyboard().text(
      translate(language, "menu.back"),
      `owner:channel:list:${page}`,
    ),
  };
}
