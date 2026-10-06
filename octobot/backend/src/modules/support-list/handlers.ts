import {
  Prisma,
  SupportListAcceptanceMode,
  SupportListAcceptanceStatus,
  SupportListFormat,
  SupportListScheduleMode,
  SupportedLanguage,
  type Bot as DatabaseBot,
  type PrismaClient,
} from "@prisma/client";
import type { Bot as TelegramBot, Context } from "grammy";
import type { Redis } from "ioredis";
import {
  BotAdminRequiredError,
  BotPermissionsRequiredError,
  ChannelAdministratorRequiredError,
  ChannelNotFoundError,
} from "../channels/channel.service.js";
import {
  clearChannelLinkState,
  getChannelLinkState,
  saveChannelLinkState,
} from "../channels/channel-link-state.js";
import { classifyChannelMembership } from "../channels/channel-membership.js";
import { resolveChannelChatReference } from "../channels/channel-reference.js";
import {
  translate,
  type TranslationKey,
} from "../localization/localization.service.js";
import { parseSupportedLanguage } from "../localization/supported-languages.js";
import type { DashboardView } from "../bots/platform-menu.js";
import { setExplicitLanguage, syncBotUser } from "../users/user.service.js";
import {
  PromoterRequiredError,
  TelegramUnavailableError,
  botCanInvite,
} from "./access.js";
import {
  ADMIN_REASON_LIMIT,
  DEFAULT_RETENTION_MINUTES,
  DEFAULT_TIME_ZONE,
  MAX_CUSTOM_TIMES,
} from "./constants.js";
import { parseContactUrl, parseListName } from "./contact-url.js";
import {
  replaceUnstartedCycles,
  skipOverduePendingCycles,
} from "./cycles.js";
import { disableReasonCodes } from "./eligibility.js";
import {
  clearSupportListDraft,
  getSupportListDraft,
  saveSupportListDraft,
} from "./input-state.js";
import {
  acceptMembership,
  activateMembership,
  disableByAdmin,
  disableByParticipant,
  ensureSettings,
  getMembershipForBot,
  openMembership,
  pageMemberships,
  rejectMembership,
  softDeleteMembership,
  submitSupportChannel,
  syncSupportListRights,
  type MembershipPageItem,
} from "./membership.service.js";
import {
  buildAcceptanceMenu,
  buildAdminHome,
  buildDeleteConfirm,
  buildFormatMenu,
  buildListNamePrompt,
  buildMembershipDetail,
  buildMembershipList,
  buildPrompt,
  buildReasonView,
  buildRequestKeyboard,
  buildResetSettingsConfirm,
  buildResetSlotsConfirm,
  buildScheduleMenu,
  buildSlotDeleteConfirm,
  buildSlotsMenu,
  buildSupportAddChannel,
  buildSupportLanguageMenu,
  buildSupportListHome,
  buildTimeZoneMenu,
  type ListScope,
} from "./menu.js";
import {
  countUnconfirmedPublications,
  previewSupportList,
} from "./publisher.js";
import {
  formatClock,
  formatInTimeZone,
  isValidTimeZone,
  parseClock,
  parseRetentionMinutes,
  readCustomSlots,
  serializeCustomSlots,
  validateCustomSlots,
  type CustomSlot,
} from "./schedule.js";

const INPUT_DISMISS_MS = 5000;

function dismissLater(
  bot: TelegramBot,
  chatId: number,
  messageId: number | undefined,
): void {
  if (!messageId) {
    return;
  }
  setTimeout(() => {
    void bot.api.deleteMessage(chatId, messageId).catch(() => undefined);
  }, INPUT_DISMISS_MS);
}

async function editStoredPanel(
  deps: SupportListRuntime & { bot: TelegramBot },
  chatId: number,
  messageId: number,
  view: DashboardView,
): Promise<void> {
  await deps.bot.api
    .editMessageText(chatId, messageId, view.text, {
      reply_markup: view.keyboard,
    })
    .catch(() => undefined);
}

export interface SupportListRuntime {
  prisma: PrismaClient;
  redis: Redis;
  getRecord: () => DatabaseBot;
  getOwnerTelegramId: () => Promise<number>;
  showDashboard: (context: Context, view: DashboardView) => Promise<void>;
  editDashboard: (context: Context, view: DashboardView) => Promise<void>;
}

const SCOPES = new Set<ListScope>(["m", "a", "p", "r"]);

function submitErrorKey(error: unknown): TranslationKey {
  if (error instanceof PromoterRequiredError) {
    return "supportList.promoterRequired";
  }
  if (error instanceof ChannelAdministratorRequiredError) {
    return "channelLink.administratorRequired";
  }
  if (error instanceof BotAdminRequiredError) {
    return "channelLink.botAdminRequired";
  }
  if (error instanceof BotPermissionsRequiredError) {
    return "channelLink.requiredPermissions";
  }
  if (error instanceof ChannelNotFoundError) {
    return "channelLink.notFound";
  }
  if (error instanceof TelegramUnavailableError) {
    return "supportList.unavailable";
  }
  return "channelLink.failed";
}

async function languageOf(
  deps: SupportListRuntime,
  telegramUserId: number,
): Promise<SupportedLanguage> {
  const user = await deps.prisma.user.findUnique({
    where: { telegramId: BigInt(telegramUserId) },
    select: { id: true },
  });
  if (!user) {
    return SupportedLanguage.EN;
  }
  const preference = await deps.prisma.userBotPreference.findUnique({
    where: {
      userId_botId: { userId: user.id, botId: deps.getRecord().id },
    },
    select: { language: true },
  });
  return preference?.language ?? SupportedLanguage.EN;
}

async function isOwner(
  deps: SupportListRuntime,
  telegramUserId: number,
): Promise<boolean> {
  return telegramUserId === (await deps.getOwnerTelegramId());
}

async function acceptedCount(
  deps: SupportListRuntime,
): Promise<number> {
  return deps.prisma.supportListMembership.count({
    where: {
      botId: deps.getRecord().id,
      deletedAt: null,
      acceptanceStatus: SupportListAcceptanceStatus.ACCEPTED,
    },
  });
}

async function showHome(
  context: Context,
  deps: SupportListRuntime,
  telegramUserId: number,
): Promise<void> {
  const { preference } = await syncBotUser(
    deps.prisma,
    context.from!,
    deps.getRecord().id,
  );
  const settings = await ensureSettings(deps.prisma, deps.getRecord().id);
  const owner = await isOwner(deps, telegramUserId);
  const view = buildSupportListHome(
    settings,
    preference.language,
    owner,
    await acceptedCount(deps),
    owner
      ? await countUnconfirmedPublications(deps.prisma, deps.getRecord().id)
      : 0,
  );
  if (context.callbackQuery) {
    await deps.editDashboard(context, view);
    return;
  }
  await deps.showDashboard(context, view);
}

export async function presentSupportListHome(
  context: Context,
  deps: SupportListRuntime,
): Promise<void> {
  if (!context.from || context.chat?.type !== "private") {
    return;
  }
  if (!deps.getRecord().isActive) {
    return;
  }
  await Promise.all([
    clearChannelLinkState(deps.redis, deps.getRecord().id, context.from.id),
    clearSupportListDraft(deps.redis, deps.getRecord().id, context.from.id),
  ]);
  await showHome(context, deps, context.from.id);
}

function noticeKey(
  event: "permissions_lost" | "permissions_restored" | "invite_lost" | "invite_restored",
): TranslationKey {
  if (event === "permissions_lost") return "supportList.permissionsLostNotice";
  if (event === "permissions_restored") return "supportList.permissionsRestoredNotice";
  if (event === "invite_lost") return "supportList.inviteLostNotice";
  return "supportList.inviteRestoredNotice";
}

async function notifyUser(
  deps: SupportListRuntime,
  telegramId: number,
  userId: string,
  key: TranslationKey,
  variables: Record<string, string | number>,
  extra?: { reply_markup?: ReturnType<typeof buildRequestKeyboard> },
): Promise<void> {
  const preference = await deps.prisma.userBotPreference.findUnique({
    where: {
      userId_botId: { userId, botId: deps.getRecord().id },
    },
    select: { language: true },
  });
  const botUser = contextBot(deps);
  await botUser.api
    .sendMessage(telegramId, translate(preference?.language ?? SupportedLanguage.EN, key, variables), extra)
    .catch(() => undefined);
}

function contextBot(deps: SupportListRuntime): TelegramBot {
  return (deps as SupportListRuntime & { bot?: TelegramBot }).bot!;
}

export function bindSupportListBot(
  deps: SupportListRuntime,
  bot: TelegramBot,
): SupportListRuntime & { bot: TelegramBot } {
  return Object.assign(deps, { bot });
}

async function finishSubmit(
  deps: SupportListRuntime & { bot: TelegramBot },
  actorTelegramId: number,
  actorUserId: string,
  result: Awaited<ReturnType<typeof submitSupportChannel>>,
  publicUrl: string | null,
): Promise<string> {
  const language = await languageOf(deps, actorTelegramId);
  if (result.kind === "duplicate") {
    return translate(language, "supportList.duplicate");
  }
  if (result.kind === "full") {
    return translate(language, "supportList.listFull");
  }
  if (result.kind === "pending") {
    const ownerTelegramId = await deps.getOwnerTelegramId();
    const owner = await deps.prisma.user.findUnique({
      where: { telegramId: BigInt(ownerTelegramId) },
      select: { id: true },
    });
    if (owner) {
      const ownerLanguage = await languageOf(deps, ownerTelegramId);
      await deps.bot.api
        .sendMessage(
          ownerTelegramId,
          translate(ownerLanguage, "supportList.requestArrived", {
            title: result.title,
          }),
          {
            reply_markup: buildRequestKeyboard(
              ownerLanguage,
              result.membershipId,
              publicUrl,
            ),
          },
        )
        .catch(() => undefined);
    }
    return translate(language, "supportList.submittedPending", {
      title: result.title,
    });
  }
  return translate(language, "supportList.submittedAccepted", {
    title: result.title,
  });
}

export async function handleSupportListMyChatMember(
  context: Context,
  deps: SupportListRuntime & { bot: TelegramBot },
): Promise<void> {
  if (context.chat?.type !== "channel" || !context.myChatMember) {
    return;
  }
  const chatId = context.chat.id;
  const chatTitle = context.chat.title;
  const chatUsername = context.chat.username;
  const membership = context.myChatMember.new_chat_member;
  const outcome = classifyChannelMembership(membership);
  const hasInvite =
    outcome === "VALID" && botCanInvite(membership);
  if (outcome !== "VALID") {
    const notices = await syncSupportListRights({
      prisma: deps.prisma,
      botId: deps.getRecord().id,
      channelTelegramId: chatId,
      valid: false,
      isPrivate: !chatUsername,
      hasInvite: false,
    });
    for (const notice of notices) {
      const row = await deps.prisma.channel.findUnique({
        where: { channelTelegramId: BigInt(chatId) },
        select: { title: true, username: true },
      });
      await notifyUser(deps, notice.telegramId, notice.addedByUserId, noticeKey(notice.event), {
        title: row?.title ?? row?.username ?? String(chatId),
      });
    }
    return;
  }

  const notices = await syncSupportListRights({
    prisma: deps.prisma,
    botId: deps.getRecord().id,
    channelTelegramId: chatId,
    valid: true,
    isPrivate: !chatUsername,
    hasInvite,
  });
  for (const notice of notices) {
    await notifyUser(deps, notice.telegramId, notice.addedByUserId, noticeKey(notice.event), {
      title: chatTitle ?? chatUsername ?? String(chatId),
    });
  }

  const live = await deps.prisma.supportListMembership.findFirst({
    where: {
      botId: deps.getRecord().id,
      channelTelegramId: BigInt(chatId),
      deletedAt: null,
      acceptanceStatus: { not: SupportListAcceptanceStatus.REJECTED },
    },
    select: { id: true },
  });
  if (live || !context.from) {
    return;
  }
  const { user } = await syncBotUser(deps.prisma, context.from, deps.getRecord().id);
  try {
    const result = await submitSupportChannel({
      prisma: deps.prisma,
      telegramBot: deps.bot,
      botId: deps.getRecord().id,
      addedByUserId: user.id,
      actorTelegramId: context.from.id,
      chatReference: chatId,
    });
    const text = await finishSubmit(
      deps,
      context.from.id,
      user.id,
      result,
      chatUsername ? `https://t.me/${chatUsername}` : null,
    );
    await deps.bot.api.sendMessage(context.from.id, text).catch(() => undefined);
  } catch (error) {
    const language = await languageOf(deps, context.from.id);
    await deps.bot.api
      .sendMessage(context.from.id, translate(language, submitErrorKey(error)))
      .catch(() => undefined);
  }
}

async function showScopedList(
  context: Context,
  deps: SupportListRuntime,
  scope: ListScope,
  page: number,
): Promise<void> {
  if (!context.from) return;
  const language = await languageOf(deps, context.from.id);
  const owner = await isOwner(deps, context.from.id);
  if ((scope === "a" || scope === "r") && !owner) {
    await context.answerCallbackQuery({
      text: translate(language, "supportList.notAllowed"),
      show_alert: true,
    });
    return;
  }
  const user = await deps.prisma.user.findUnique({
    where: { telegramId: BigInt(context.from.id) },
  });
  if (!user) {
    await context.answerCallbackQuery();
    return;
  }
  const result = await pageMemberships({
    prisma: deps.prisma,
    botId: deps.getRecord().id,
    page,
    addedByUserId: scope === "m" || scope === "p" ? user.id : undefined,
    acceptanceStatus:
      scope === "p" || scope === "r"
        ? SupportListAcceptanceStatus.PENDING
        : scope === "m"
          ? SupportListAcceptanceStatus.ACCEPTED
          : undefined,
  });
  const title =
    scope === "p"
      ? translate(language, "supportList.pending")
      : scope === "r"
        ? translate(language, "supportList.requests")
        : scope === "a"
          ? translate(language, "supportList.allChannels")
          : translate(language, "supportList.myChannels");
  await deps.editDashboard(
    context,
    buildMembershipList({
      language,
      title,
      items: result.items,
      page: result.page,
      pages: result.pages,
      scope,
      backCallback: scope === "a" || scope === "r" ? "sl:admin" : "sl:home",
    }),
  );
  await context.answerCallbackQuery().catch(() => undefined);
}

function itemStatus(language: SupportedLanguage, item: MembershipPageItem): string {
  if (item.acceptanceStatus === "PENDING") {
    return translate(language, "supportList.statusPending");
  }
  if (disableReasonCodes(item.flags).length > 0) {
    return translate(language, "supportList.statusDisabled");
  }
  return translate(language, "supportList.statusAccepted");
}

async function scheduleView(
  deps: SupportListRuntime,
  language: SupportedLanguage,
): Promise<DashboardView> {
  const settings = await ensureSettings(deps.prisma, deps.getRecord().id);
  const next = await deps.prisma.supportListCycle.findFirst({
    where: {
      botId: deps.getRecord().id,
      status: "PENDING",
      scheduledAt: { gt: new Date() },
    },
    orderBy: { scheduledAt: "asc" },
  });
  const slots = readCustomSlots(settings.customTimes, settings.retentionMinutes);
  const times = slots
    .map((slot) => `${formatClock(slot.time)} (${slot.retentionMinutes})`)
    .join(", ");
  return buildScheduleMenu({
      language,
      timeZone: settings.timeZone,
      modeLabel:
        settings.scheduleMode === SupportListScheduleMode.CUSTOM
          ? translate(language, "supportList.customMode", { times: times || "—" })
          : translate(language, "supportList.defaultMode"),
      publishing: settings.publishingEnabled,
      next: next
        ? `${formatInTimeZone(next.scheduledAt, settings.timeZone)} (${settings.timeZone})`
        : translate(language, "supportList.noNext"),
  });
}

async function showSchedule(
  context: Context,
  deps: SupportListRuntime,
): Promise<void> {
  if (!context.from) return;
  const language = await languageOf(deps, context.from.id);
  await deps.editDashboard(context, await scheduleView(deps, language));
}

async function slotsView(
  deps: SupportListRuntime,
  language: SupportedLanguage,
): Promise<DashboardView> {
  const settings = await ensureSettings(deps.prisma, deps.getRecord().id);
  const slots = readCustomSlots(settings.customTimes, settings.retentionMinutes);
  return buildSlotsMenu(
    language,
    settings.scheduleMode,
    settings.scheduleMode === SupportListScheduleMode.CUSTOM
      ? slots.map((slot) => ({
          time: formatClock(slot.time),
          retentionMinutes: slot.retentionMinutes,
        }))
      : [],
  );
}

async function adminView(
  deps: SupportListRuntime,
  language: SupportedLanguage,
): Promise<DashboardView> {
  const settings = await ensureSettings(deps.prisma, deps.getRecord().id);
  return buildAdminHome(
    language,
    settings,
    await acceptedCount(deps),
    await countUnconfirmedPublications(deps.prisma, deps.getRecord().id),
  );
}

async function saveCustomSlots(
  deps: SupportListRuntime,
  slots: CustomSlot[],
): Promise<void> {
  const saved = serializeCustomSlots(slots);
  await deps.prisma.supportListSettings.update({
    where: { botId: deps.getRecord().id },
    data: {
      scheduleMode: SupportListScheduleMode.CUSTOM,
      customTimes: saved as unknown as Prisma.InputJsonValue,
    },
  });
  await replaceUnstartedCycles(deps.prisma, deps.getRecord().id);
}

export function registerSupportListHandlers(
  bot: TelegramBot,
  deps: SupportListRuntime,
): void {
  const bound = bindSupportListBot(deps, bot);

  bot.callbackQuery("sl:home", async (context) => {
    if (!context.from) return;
    await Promise.all([
      clearChannelLinkState(bound.redis, bound.getRecord().id, context.from.id),
      clearSupportListDraft(bound.redis, bound.getRecord().id, context.from.id),
    ]);
    await showHome(context, bound, context.from.id);
    await context.answerCallbackQuery();
  });

  bot.callbackQuery("sl:lang", async (context) => {
    if (!context.from) return;
    const language = await languageOf(bound, context.from.id);
    await bound.editDashboard(context, buildSupportLanguageMenu(language));
    await context.answerCallbackQuery();
  });

  bot.callbackQuery(/^sl:lang:(AR|EN)$/, async (context) => {
    if (!context.from) return;
    const selected = parseSupportedLanguage(context.match[1] ?? "");
    if (!selected) {
      await context.answerCallbackQuery();
      return;
    }
    const { user } = await syncBotUser(bound.prisma, context.from, bound.getRecord().id);
    await setExplicitLanguage(bound.prisma, user.id, bound.getRecord().id, selected);
    await showHome(context, bound, context.from.id);
    await context.answerCallbackQuery();
  });

  bot.callbackQuery("sl:add", async (context) => {
    if (!context.from || !context.chat) return;
    await clearSupportListDraft(bound.redis, bound.getRecord().id, context.from.id);
    await saveChannelLinkState(bound.redis, bound.getRecord().id, context.from.id, {
      chatId: context.chat.id,
    });
    const language = await languageOf(bound, context.from.id);
    await bound.editDashboard(
      context,
      buildSupportAddChannel(language, bound.getRecord().botUsername),
    );
    await context.answerCallbackQuery();
  });

  bot.callbackQuery("sl:contact", async (context) => {
    if (!context.from) return;
    const language = await languageOf(bound, context.from.id);
    await context.answerCallbackQuery({
      text: translate(language, "supportList.contactMissing"),
      show_alert: true,
    });
  });

  bot.callbackQuery(/^sl:(mine|pend|reqs|all):(\d+)$/, async (context) => {
    const scope: ListScope =
      context.match[1] === "pend"
        ? "p"
        : context.match[1] === "reqs"
          ? "r"
          : context.match[1] === "all"
            ? "a"
            : "m";
    await showScopedList(context, bound, scope, Number(context.match[2]));
  });

  bot.callbackQuery(/^sl:list:([mapr]):(\d+)$/, async (context) => {
    const scope = context.match[1] as ListScope;
    if (!SCOPES.has(scope)) {
      await context.answerCallbackQuery();
      return;
    }
    await showScopedList(context, bound, scope, Number(context.match[2]));
  });

  bot.callbackQuery(/^sl:item:([^:]+):(\d+):([mapr])$/, async (context) => {
    if (!context.from) return;
    const language = await languageOf(bound, context.from.id);
    const membership = await getMembershipForBot(
      bound.prisma,
      bound.getRecord().id,
      context.match[1] ?? "",
    );
    if (!membership) {
      await context.answerCallbackQuery({
        text: translate(language, "management.notFound"),
        show_alert: true,
      });
      return;
    }
    const owner = await isOwner(bound, context.from.id);
    const actor = await bound.prisma.user.findUnique({
      where: { telegramId: BigInt(context.from.id) },
    });
    if (!owner && actor?.id !== membership.addedByUserId) {
      await context.answerCallbackQuery({
        text: translate(language, "supportList.notAllowed"),
        show_alert: true,
      });
      return;
    }
    const item: MembershipPageItem = {
      id: membership.id,
      title: membership.channel.title ?? membership.channel.username ?? membership.id,
      acceptanceStatus: membership.acceptanceStatus,
      flags: {
        participantDisabled: membership.participantDisabled,
        adminDisabled: membership.adminDisabled,
        adminDisableReason: membership.adminDisableReason,
        permissionsLost: membership.permissionsLost,
        inviteUnavailable: membership.inviteUnavailable,
      },
    };
    await bound.editDashboard(
      context,
      buildMembershipDetail({
        language,
        title: item.title,
        status: itemStatus(language, item),
        membershipId: membership.id,
        page: Number(context.match[2]),
        scope: context.match[3] as ListScope,
        flags: item.flags,
        pendingReview: owner && membership.acceptanceStatus === "PENDING",
      }),
    );
    await context.answerCallbackQuery();
  });

  bot.callbackQuery(/^sl:view:([^:]+):(\d+):([mapr])$/, async (context) => {
    if (!context.from) return;
    const language = await languageOf(bound, context.from.id);
    const opened = await openMembership({
      prisma: bound.prisma,
      telegramBot: bot,
      botId: bound.getRecord().id,
      membershipId: context.match[1] ?? "",
    });
    if (opened.kind === "url") {
      await context.answerCallbackQuery();
      await bound.bot.api
        .sendMessage(context.from.id, opened.title, {
          reply_markup: { inline_keyboard: [[{ text: translate(language, "supportList.view"), url: opened.url }]] },
        })
        .catch(() => undefined);
      return;
    }
    await context.answerCallbackQuery({
      text: translate(
        language,
        opened.kind === "invite_disabled"
          ? "supportList.inviteShort"
          : opened.kind === "unavailable"
            ? "supportList.unavailable"
            : "management.notFound",
      ),
      show_alert: true,
    });
  });

  bot.callbackQuery(/^sl:on:([^:]+):(\d+):([mapr])$/, async (context) => {
    if (!context.from) return;
    const language = await languageOf(bound, context.from.id);
    const actor = await bound.prisma.user.findUnique({
      where: { telegramId: BigInt(context.from.id) },
    });
    if (!actor) {
      await context.answerCallbackQuery();
      return;
    }
    const scope = context.match[3] as ListScope;
    const result = await activateMembership({
      prisma: bound.prisma,
      telegramBot: bot,
      botId: bound.getRecord().id,
      membershipId: context.match[1] ?? "",
      actorUserId: actor.id,
      asOwner: (await isOwner(bound, context.from.id)) && (scope === "a" || scope === "r"),
    });
    const key: TranslationKey =
      result.kind === "resumed"
        ? "supportList.resumed"
        : result.kind === "permissions"
          ? "supportList.permissionsShort"
          : result.kind === "invite"
            ? "supportList.inviteShort"
            : result.kind === "unavailable"
              ? "supportList.unavailable"
              : result.kind === "still_blocked"
                ? "supportList.stillBlocked"
                : "management.notFound";
    await context.answerCallbackQuery({
      text: translate(language, key),
      show_alert: true,
    });
    await showScopedList(context, bound, scope, Number(context.match[2]));
  });

  bot.callbackQuery(/^sl:off:([^:]+):(\d+):([mapr])$/, async (context) => {
    if (!context.from || !context.chat || !context.callbackQuery?.message) return;
    const language = await languageOf(bound, context.from.id);
    const scope = context.match[3] as ListScope;
    const owner = await isOwner(bound, context.from.id);
    if (owner && (scope === "a" || scope === "r")) {
      const message = context.callbackQuery.message;
      if (!("message_id" in message)) {
        await context.answerCallbackQuery();
        return;
      }
      await clearChannelLinkState(bound.redis, bound.getRecord().id, context.from.id);
      await saveSupportListDraft(bound.redis, bound.getRecord().id, context.from.id, {
        kind: "adminReason",
        chatId: context.chat.id,
        dashboardMessageId: message.message_id,
        membershipId: context.match[1] ?? "",
        page: Number(context.match[2]),
        scope,
      });
      await bound.editDashboard(
        context,
        buildPrompt(language, translate(language, "supportList.adminReasonPrompt"), "sl:admin"),
      );
      await context.answerCallbackQuery();
      return;
    }
    const actor = await bound.prisma.user.findUnique({
      where: { telegramId: BigInt(context.from.id) },
    });
    if (!actor) {
      await context.answerCallbackQuery();
      return;
    }
    const updated = await disableByParticipant(
      bound.prisma,
      bound.getRecord().id,
      context.match[1] ?? "",
      actor.id,
    );
    await context.answerCallbackQuery({
      text: translate(
        language,
        updated ? "supportList.disabledByYou" : "management.notFound",
      ),
      show_alert: true,
    });
    await showScopedList(context, bound, scope, Number(context.match[2]));
  });

  bot.callbackQuery(/^sl:del:([^:]+):(\d+):([mapr])$/, async (context) => {
    if (!context.from) return;
    const language = await languageOf(bound, context.from.id);
    const membership = await getMembershipForBot(
      bound.prisma,
      bound.getRecord().id,
      context.match[1] ?? "",
    );
    if (!membership) {
      await context.answerCallbackQuery({
        text: translate(language, "management.notFound"),
        show_alert: true,
      });
      return;
    }
    await bound.editDashboard(
      context,
      buildDeleteConfirm(
        language,
        membership.channel.title ?? membership.id,
        membership.id,
        Number(context.match[2]),
        context.match[3] as ListScope,
      ),
    );
    await context.answerCallbackQuery();
  });

  bot.callbackQuery(/^sl:yes:([^:]+):(\d+):([mapr])$/, async (context) => {
    if (!context.from) return;
    const language = await languageOf(bound, context.from.id);
    const scope = context.match[3] as ListScope;
    const existing = await getMembershipForBot(
      bound.prisma,
      bound.getRecord().id,
      context.match[1] ?? "",
    );
    const removed = await softDeleteMembership(
      bound.prisma,
      bound.getRecord().id,
      context.match[1] ?? "",
    );
    const owner = await isOwner(bound, context.from.id);
    if (
      removed &&
      existing &&
      owner &&
      Number(existing.addedBy.telegramId) !== context.from.id
    ) {
      await notifyUser(
        bound,
        Number(existing.addedBy.telegramId),
        existing.addedByUserId,
        "supportList.adminDeletedNotice",
        { title: existing.channel.title ?? existing.id },
      );
    }
    await context.answerCallbackQuery({
      text: translate(language, removed ? "supportList.deleted" : "management.notFound"),
      show_alert: true,
    });
    await showScopedList(context, bound, scope, Number(context.match[2]));
  });

  bot.callbackQuery(/^sl:why:([^:]+):(\d+):([mapr])$/, async (context) => {
    if (!context.from) return;
    const language = await languageOf(bound, context.from.id);
    const membership = await getMembershipForBot(
      bound.prisma,
      bound.getRecord().id,
      context.match[1] ?? "",
    );
    if (!membership) {
      await context.answerCallbackQuery();
      return;
    }
    await bound.editDashboard(
      context,
      buildReasonView({
        language,
        title: membership.channel.title ?? membership.id,
        flags: {
          participantDisabled: membership.participantDisabled,
          adminDisabled: membership.adminDisabled,
          adminDisableReason: membership.adminDisableReason,
          permissionsLost: membership.permissionsLost,
          inviteUnavailable: membership.inviteUnavailable,
        },
        membershipId: membership.id,
        page: Number(context.match[2]),
        scope: context.match[3] as ListScope,
      }),
    );
    await context.answerCallbackQuery();
  });

  bot.callbackQuery(/^sl:acc:([^:]+)$/, async (context) => {
    if (!context.from) return;
    const language = await languageOf(bound, context.from.id);
    if (!(await isOwner(bound, context.from.id))) {
      await context.answerCallbackQuery({
        text: translate(language, "supportList.notAllowed"),
        show_alert: true,
      });
      return;
    }
    const before = await getMembershipForBot(
      bound.prisma,
      bound.getRecord().id,
      context.match[1] ?? "",
    );
    const result = await acceptMembership(
      bound.prisma,
      bound.getRecord().id,
      context.match[1] ?? "",
    );
    if (result === "accepted" && before) {
      await notifyUser(
        bound,
        Number(before.addedBy.telegramId),
        before.addedByUserId,
        "supportList.acceptedNotice",
        { title: before.channel.title ?? before.id },
      );
    }
    await context.answerCallbackQuery({
      text: translate(
        language,
        result === "accepted"
          ? "supportList.submittedAccepted"
          : result === "full"
            ? "supportList.listFull"
            : "management.notFound",
        { title: before?.channel.title ?? "" },
      ),
      show_alert: true,
    });
  });

  bot.callbackQuery(/^sl:rej:([^:]+)$/, async (context) => {
    if (!context.from) return;
    const language = await languageOf(bound, context.from.id);
    if (!(await isOwner(bound, context.from.id))) {
      await context.answerCallbackQuery({
        text: translate(language, "supportList.notAllowed"),
        show_alert: true,
      });
      return;
    }
    const before = await getMembershipForBot(
      bound.prisma,
      bound.getRecord().id,
      context.match[1] ?? "",
    );
    const rejected = await rejectMembership(
      bound.prisma,
      bound.getRecord().id,
      context.match[1] ?? "",
    );
    if (rejected && before) {
      await notifyUser(
        bound,
        Number(before.addedBy.telegramId),
        before.addedByUserId,
        "supportList.rejectedNotice",
        { title: before.channel.title ?? before.id },
      );
    }
    await context.answerCallbackQuery({
      text: translate(language, rejected ? "supportList.rejectedNotice" : "management.notFound", {
        title: before?.channel.title ?? "",
      }),
      show_alert: true,
    });
  });

  const ownerOnly = async (context: Context): Promise<boolean> => {
    if (!context.from) return false;
    if (await isOwner(bound, context.from.id)) return true;
    const language = await languageOf(bound, context.from.id);
    await context.answerCallbackQuery({
      text: translate(language, "supportList.notAllowed"),
      show_alert: true,
    });
    return false;
  };

  bot.callbackQuery("sl:admin", async (context) => {
    if (!(await ownerOnly(context)) || !context.from) return;
    await clearSupportListDraft(bound.redis, bound.getRecord().id, context.from.id);
    const language = await languageOf(bound, context.from.id);
    const settings = await ensureSettings(bound.prisma, bound.getRecord().id);
    await bound.editDashboard(
      context,
      buildAdminHome(
        language,
        settings,
        await acceptedCount(bound),
        await countUnconfirmedPublications(bound.prisma, bound.getRecord().id),
      ),
    );
    await context.answerCallbackQuery();
  });

  bot.callbackQuery("sl:name", async (context) => {
    if (!(await ownerOnly(context)) || !context.from || !context.chat) return;
    const message = context.callbackQuery?.message;
    if (!message || !("message_id" in message)) {
      await context.answerCallbackQuery();
      return;
    }
    const language = await languageOf(bound, context.from.id);
    const settings = await ensureSettings(bound.prisma, bound.getRecord().id);
    await clearChannelLinkState(bound.redis, bound.getRecord().id, context.from.id);
    await saveSupportListDraft(bound.redis, bound.getRecord().id, context.from.id, {
      kind: "listName",
      chatId: context.chat.id,
      dashboardMessageId: message.message_id,
    });
    await bound.editDashboard(
      context,
      buildListNamePrompt(language, settings.listName),
    );
    await context.answerCallbackQuery();
  });

  bot.callbackQuery("sl:mode", async (context) => {
    if (!(await ownerOnly(context)) || !context.from) return;
    const language = await languageOf(bound, context.from.id);
    await bound.editDashboard(context, buildAcceptanceMenu(language));
    await context.answerCallbackQuery();
  });

  bot.callbackQuery(/^sl:mode:(MANUAL|AUTO)$/, async (context) => {
    if (!(await ownerOnly(context)) || !context.from) return;
    const mode =
      context.match[1] === "AUTO"
        ? SupportListAcceptanceMode.AUTO
        : SupportListAcceptanceMode.MANUAL;
    await bound.prisma.supportListSettings.update({
      where: { botId: bound.getRecord().id },
      data: { acceptanceMode: mode },
    });
    const language = await languageOf(bound, context.from.id);
    await context.answerCallbackQuery({
      text: translate(language, "supportList.saved"),
      show_alert: true,
    });
    const settings = await ensureSettings(bound.prisma, bound.getRecord().id);
    await bound.editDashboard(
      context,
      buildAdminHome(
        language,
        settings,
        await acceptedCount(bound),
        await countUnconfirmedPublications(bound.prisma, bound.getRecord().id),
      ),
    );
  });

  bot.callbackQuery("sl:fmt", async (context) => {
    if (!(await ownerOnly(context)) || !context.from) return;
    const language = await languageOf(bound, context.from.id);
    await bound.editDashboard(context, buildFormatMenu(language));
    await context.answerCallbackQuery();
  });

  bot.callbackQuery(/^sl:fmt:(TEXT|BUTTONS)$/, async (context) => {
    if (!(await ownerOnly(context)) || !context.from) return;
    await bound.prisma.supportListSettings.update({
      where: { botId: bound.getRecord().id },
      data: {
        format:
          context.match[1] === "BUTTONS"
            ? SupportListFormat.BUTTONS
            : SupportListFormat.TEXT,
      },
    });
    const language = await languageOf(bound, context.from.id);
    await context.answerCallbackQuery({
      text: translate(language, "supportList.saved"),
      show_alert: true,
    });
    const settings = await ensureSettings(bound.prisma, bound.getRecord().id);
    await bound.editDashboard(
      context,
      buildAdminHome(
        language,
        settings,
        await acceptedCount(bound),
        await countUnconfirmedPublications(bound.prisma, bound.getRecord().id),
      ),
    );
  });

  bot.callbackQuery("sl:preview", async (context) => {
    if (!(await ownerOnly(context)) || !context.from) return;
    const language = await languageOf(bound, context.from.id);
    const built = await previewSupportList(bound.prisma, bot, bound.getRecord().id);
    if (built.kind === "empty") {
      await context.answerCallbackQuery({
        text: translate(language, "supportList.previewEmpty"),
        show_alert: true,
      });
      return;
    }
    if (built.kind === "unfit") {
      await context.answerCallbackQuery({
        text: translate(language, "supportList.previewUnfit"),
        show_alert: true,
      });
      return;
    }
    if (built.kind === "unavailable") {
      await context.answerCallbackQuery({
        text: translate(language, "supportList.unavailable"),
        show_alert: true,
      });
      return;
    }
    const keyboard = built.rendered.buttons
      ? {
          inline_keyboard: built.rendered.buttons.map((button) => [
            { text: button.label, url: button.url },
          ]),
        }
      : undefined;
    await context.answerCallbackQuery();
    await bot.api
      .sendMessage(context.from.id, built.rendered.text, {
        reply_markup: keyboard,
        link_preview_options: { is_disabled: true },
      })
      .catch(() => undefined);
  });

  bot.callbackQuery("sl:sched", async (context) => {
    if (!(await ownerOnly(context)) || !context.from) return;
    await clearSupportListDraft(bound.redis, bound.getRecord().id, context.from.id);
    await showSchedule(context, bound);
    await context.answerCallbackQuery();
  });

  bot.callbackQuery("sl:pause", async (context) => {
    if (!(await ownerOnly(context))) return;
    const language = context.from
      ? await languageOf(bound, context.from.id)
      : SupportedLanguage.EN;
    await bound.prisma.supportListSettings.update({
      where: { botId: bound.getRecord().id },
      data: { publishingEnabled: false },
    });
    await showSchedule(context, bound);
    await context.answerCallbackQuery({
      text: translate(language, "supportList.saved"),
      show_alert: true,
    });
  });

  bot.callbackQuery("sl:resume", async (context) => {
    if (!(await ownerOnly(context))) return;
    const language = context.from
      ? await languageOf(bound, context.from.id)
      : SupportedLanguage.EN;
    await skipOverduePendingCycles(bound.prisma, bound.getRecord().id);
    await bound.prisma.supportListSettings.update({
      where: { botId: bound.getRecord().id },
      data: { publishingEnabled: true },
    });
    await showSchedule(context, bound);
    await context.answerCallbackQuery({
      text: translate(language, "supportList.saved"),
      show_alert: true,
    });
  });

  bot.callbackQuery("sl:addslot", async (context) => {
    if (!(await ownerOnly(context)) || !context.from || !context.chat) return;
    const message = context.callbackQuery?.message;
    if (!message || !("message_id" in message)) {
      await context.answerCallbackQuery();
      return;
    }
    const language = await languageOf(bound, context.from.id);
    const settings = await ensureSettings(bound.prisma, bound.getRecord().id);
    const slots = readCustomSlots(settings.customTimes, settings.retentionMinutes);
    if (
      settings.scheduleMode === SupportListScheduleMode.CUSTOM &&
      slots.length >= MAX_CUSTOM_TIMES
    ) {
      await context.answerCallbackQuery({
        text: translate(language, "supportList.maxSlots"),
        show_alert: true,
      });
      return;
    }
    await clearChannelLinkState(bound.redis, bound.getRecord().id, context.from.id);
    await saveSupportListDraft(bound.redis, bound.getRecord().id, context.from.id, {
      kind: "slotTime",
      chatId: context.chat.id,
      dashboardMessageId: message.message_id,
      index: null,
    });
    await bound.editDashboard(
      context,
      buildPrompt(language, translate(language, "supportList.sendOneTime"), "sl:sched"),
    );
    await context.answerCallbackQuery();
  });

  bot.callbackQuery("sl:slots", async (context) => {
    if (!(await ownerOnly(context)) || !context.from) return;
    const language = await languageOf(bound, context.from.id);
    await clearSupportListDraft(bound.redis, bound.getRecord().id, context.from.id);
    await bound.editDashboard(context, await slotsView(bound, language));
    await context.answerCallbackQuery();
  });

  bot.callbackQuery("sl:default", async (context) => {
    if (!(await ownerOnly(context)) || !context.from) return;
    const language = await languageOf(bound, context.from.id);
    await bound.editDashboard(context, buildResetSlotsConfirm(language));
    await context.answerCallbackQuery();
  });

  bot.callbackQuery("sl:default:yes", async (context) => {
    if (!(await ownerOnly(context))) return;
    const language = context.from
      ? await languageOf(bound, context.from.id)
      : SupportedLanguage.EN;
    await bound.prisma.supportListSettings.update({
      where: { botId: bound.getRecord().id },
      data: {
        scheduleMode: SupportListScheduleMode.DEFAULT,
        retentionMinutes: DEFAULT_RETENTION_MINUTES,
        customTimes: [],
      },
    });
    await replaceUnstartedCycles(bound.prisma, bound.getRecord().id);
    await showSchedule(context, bound);
    await context.answerCallbackQuery({
      text: translate(language, "supportList.saved"),
      show_alert: true,
    });
  });

  bot.callbackQuery(/^sl:slot:time:(\d+)$/, async (context) => {
    if (!(await ownerOnly(context)) || !context.from || !context.chat) return;
    const message = context.callbackQuery?.message;
    if (!message || !("message_id" in message)) {
      await context.answerCallbackQuery();
      return;
    }
    const language = await languageOf(bound, context.from.id);
    const index = Number(context.match[1]);
    const settings = await ensureSettings(bound.prisma, bound.getRecord().id);
    const slots = readCustomSlots(settings.customTimes, settings.retentionMinutes);
    if (!Number.isInteger(index) || index < 0 || index >= slots.length) {
      await context.answerCallbackQuery({
        text: translate(language, "management.notFound"),
        show_alert: true,
      });
      return;
    }
    await saveSupportListDraft(bound.redis, bound.getRecord().id, context.from.id, {
      kind: "slotTime",
      chatId: context.chat.id,
      dashboardMessageId: message.message_id,
      index,
    });
    await bound.editDashboard(
      context,
      buildPrompt(language, translate(language, "supportList.sendOneTime"), "sl:slots"),
    );
    await context.answerCallbackQuery();
  });

  bot.callbackQuery(/^sl:slot:keep:(\d+)$/, async (context) => {
    if (!(await ownerOnly(context)) || !context.from || !context.chat) return;
    const message = context.callbackQuery?.message;
    if (!message || !("message_id" in message)) {
      await context.answerCallbackQuery();
      return;
    }
    const language = await languageOf(bound, context.from.id);
    const index = Number(context.match[1]);
    const settings = await ensureSettings(bound.prisma, bound.getRecord().id);
    const slots = readCustomSlots(settings.customTimes, settings.retentionMinutes);
    const slot = slots[index];
    if (!slot) {
      await context.answerCallbackQuery({
        text: translate(language, "management.notFound"),
        show_alert: true,
      });
      return;
    }
    await saveSupportListDraft(bound.redis, bound.getRecord().id, context.from.id, {
      kind: "slotKeep",
      chatId: context.chat.id,
      dashboardMessageId: message.message_id,
      index,
      time: formatClock(slot.time),
    });
    await bound.editDashboard(
      context,
      buildPrompt(language, translate(language, "supportList.sendRetention"), "sl:slots"),
    );
    await context.answerCallbackQuery();
  });

  bot.callbackQuery(/^sl:slot:del:(\d+)$/, async (context) => {
    if (!(await ownerOnly(context)) || !context.from) return;
    const language = await languageOf(bound, context.from.id);
    const index = Number(context.match[1]);
    const settings = await ensureSettings(bound.prisma, bound.getRecord().id);
    const slots = readCustomSlots(settings.customTimes, settings.retentionMinutes);
    const slot = slots[index];
    if (!slot) {
      await context.answerCallbackQuery({
        text: translate(language, "management.notFound"),
        show_alert: true,
      });
      return;
    }
    await bound.editDashboard(
      context,
      buildSlotDeleteConfirm(language, formatClock(slot.time), index),
    );
    await context.answerCallbackQuery();
  });

  bot.callbackQuery(/^sl:slot:yes:(\d+)$/, async (context) => {
    if (!(await ownerOnly(context))) return;
    const language = context.from
      ? await languageOf(bound, context.from.id)
      : SupportedLanguage.EN;
    const index = Number(context.match[1]);
    const settings = await ensureSettings(bound.prisma, bound.getRecord().id);
    const slots = readCustomSlots(settings.customTimes, settings.retentionMinutes);
    if (!slots[index]) {
      await context.answerCallbackQuery({
        text: translate(language, "management.notFound"),
        show_alert: true,
      });
      return;
    }
    const next = slots.filter((_, slotIndex) => slotIndex !== index);
    await bound.prisma.supportListSettings.update({
      where: { botId: bound.getRecord().id },
      data: {
        scheduleMode: SupportListScheduleMode.CUSTOM,
        customTimes: serializeCustomSlots(next) as unknown as Prisma.InputJsonValue,
      },
    });
    await replaceUnstartedCycles(bound.prisma, bound.getRecord().id);
    await bound.editDashboard(context, await slotsView(bound, language));
    await context.answerCallbackQuery({
      text: translate(language, "supportList.saved"),
      show_alert: true,
    });
  });

  bot.callbackQuery("sl:tz", async (context) => {
    if (!(await ownerOnly(context)) || !context.from) return;
    const language = await languageOf(bound, context.from.id);
    await bound.editDashboard(context, buildTimeZoneMenu(language));
    await context.answerCallbackQuery();
  });

  bot.callbackQuery(/^sl:tzset:(.+)$/, async (context) => {
    if (!(await ownerOnly(context)) || !context.from) return;
    const zone = context.match[1] ?? "";
    const language = await languageOf(bound, context.from.id);
    if (!isValidTimeZone(zone)) {
      await context.answerCallbackQuery({
        text: translate(language, "supportList.invalidTimeZone"),
        show_alert: true,
      });
      return;
    }
    await bound.prisma.supportListSettings.update({
      where: { botId: bound.getRecord().id },
      data: { timeZone: zone },
    });
    await replaceUnstartedCycles(bound.prisma, bound.getRecord().id);
    await showSchedule(context, bound);
    await context.answerCallbackQuery({
      text: translate(language, "supportList.saved"),
      show_alert: true,
    });
  });

  bot.callbackQuery("sl:reset", async (context) => {
    if (!(await ownerOnly(context)) || !context.from) return;
    const language = await languageOf(bound, context.from.id);
    await bound.editDashboard(context, buildResetSettingsConfirm(language));
    await context.answerCallbackQuery();
  });

  bot.callbackQuery("sl:reset:yes", async (context) => {
    if (!(await ownerOnly(context))) return;
    const language = context.from
      ? await languageOf(bound, context.from.id)
      : SupportedLanguage.EN;
    await bound.prisma.supportListSettings.update({
      where: { botId: bound.getRecord().id },
      data: {
        acceptanceMode: SupportListAcceptanceMode.AUTO,
        format: SupportListFormat.BUTTONS,
        timeZone: DEFAULT_TIME_ZONE,
        publishingEnabled: true,
        scheduleMode: SupportListScheduleMode.DEFAULT,
        retentionMinutes: DEFAULT_RETENTION_MINUTES,
        customTimes: [],
        contactUrl: null,
      },
    });
    await replaceUnstartedCycles(bound.prisma, bound.getRecord().id);
    await bound.editDashboard(context, await adminView(bound, language));
    await context.answerCallbackQuery({
      text: translate(language, "supportList.saved"),
      show_alert: true,
    });
  });

  bot.callbackQuery("sl:link", async (context) => {
    if (!(await ownerOnly(context)) || !context.from || !context.chat) return;
    const message = context.callbackQuery?.message;
    if (!message || !("message_id" in message)) {
      await context.answerCallbackQuery();
      return;
    }
    const language = await languageOf(bound, context.from.id);
    await clearChannelLinkState(bound.redis, bound.getRecord().id, context.from.id);
    await saveSupportListDraft(bound.redis, bound.getRecord().id, context.from.id, {
      kind: "contactUrl",
      chatId: context.chat.id,
      dashboardMessageId: message.message_id,
    });
    await bound.editDashboard(
      context,
      buildPrompt(
        language,
        `${translate(language, "supportList.sendContact")}\n\n${translate(language, "supportList.contactHint")}`,
        "sl:admin",
      ),
    );
    await context.answerCallbackQuery();
  });
}

export async function handleSupportListPrivateMessage(
  context: Context,
  deps: SupportListRuntime & { bot: TelegramBot },
): Promise<void> {
  if (!context.from || context.chat?.type !== "private" || !context.message) {
    return;
  }
  const draft = await getSupportListDraft(
    deps.redis,
    deps.getRecord().id,
    context.from.id,
  );
  if (draft && draft.chatId === context.chat.id) {
    await handleDraft(context, deps, draft);
    return;
  }
  const state = await getChannelLinkState(
    deps.redis,
    deps.getRecord().id,
    context.from.id,
  );
  if (!state || state.chatId !== context.chat.id) {
    return;
  }
  const reference = resolveChannelChatReference(context.message);
  const language = await languageOf(deps, context.from.id);
  if (reference === null) {
    await context.reply(translate(language, "channelLink.notFound"));
    return;
  }
  const { user } = await syncBotUser(deps.prisma, context.from, deps.getRecord().id);
  try {
    const result = await submitSupportChannel({
      prisma: deps.prisma,
      telegramBot: deps.bot,
      botId: deps.getRecord().id,
      addedByUserId: user.id,
      actorTelegramId: context.from.id,
      chatReference: reference,
    });
    const text = await finishSubmit(deps, context.from.id, user.id, result, null);
    await context.reply(text);
    if (result.kind === "accepted" || result.kind === "pending") {
      await clearChannelLinkState(deps.redis, deps.getRecord().id, context.from.id);
    }
  } catch (error) {
    await context.reply(translate(language, submitErrorKey(error)));
  }
}

async function handleDraft(
  context: Context,
  deps: SupportListRuntime & { bot: TelegramBot },
  draft: NonNullable<Awaited<ReturnType<typeof getSupportListDraft>>>,
): Promise<void> {
  if (!context.from || !context.chat || !context.message?.text) return;
  const language = await languageOf(deps, context.from.id);
  const text = context.message.text.trim();
  const userMessageId = context.message.message_id;
  const fail = async (key: TranslationKey) => {
    const sent = await context.reply(translate(language, key));
    dismissLater(deps.bot, context.chat!.id, userMessageId);
    dismissLater(deps.bot, context.chat!.id, sent.message_id);
  };
  const finish = async (view: DashboardView) => {
    await clearSupportListDraft(deps.redis, deps.getRecord().id, context.from!.id);
    dismissLater(deps.bot, context.chat!.id, userMessageId);
    await editStoredPanel(deps, draft.chatId, draft.dashboardMessageId, view);
  };
  if (draft.kind === "listName") {
    const name = parseListName(text);
    if (!name) {
      await fail("supportList.invalidListName");
      return;
    }
    await deps.prisma.supportListSettings.update({
      where: { botId: deps.getRecord().id },
      data: { listName: name },
    });
    await finish(await adminView(deps, language));
    return;
  }
  if (draft.kind === "contactUrl") {
    const url = parseContactUrl(text);
    if (!url) {
      await fail("supportList.invalidContact");
      return;
    }
    await deps.prisma.supportListSettings.update({
      where: { botId: deps.getRecord().id },
      data: { contactUrl: url },
    });
    await finish(await adminView(deps, language));
    return;
  }
  if (draft.kind === "slotTime") {
    const time = parseClock(text);
    if (!time) {
      await fail("supportList.invalidTimes");
      return;
    }
    const settings = await ensureSettings(deps.prisma, deps.getRecord().id);
    const slots = readCustomSlots(settings.customTimes, settings.retentionMinutes);
    if (draft.index === null) {
      await saveSupportListDraft(deps.redis, deps.getRecord().id, context.from.id, {
        kind: "slotKeep",
        chatId: draft.chatId,
        dashboardMessageId: draft.dashboardMessageId,
        index: null,
        time: formatClock(time),
      });
      dismissLater(deps.bot, context.chat.id, userMessageId);
      await editStoredPanel(
        deps,
        draft.chatId,
        draft.dashboardMessageId,
        buildPrompt(language, translate(language, "supportList.sendRetention"), "sl:sched"),
      );
      return;
    }
    const current = slots[draft.index];
    if (!current) {
      await fail("management.notFound");
      return;
    }
    const next = slots.map((slot, index) =>
      index === draft.index ? { time, retentionMinutes: slot.retentionMinutes } : slot,
    );
    const check = validateCustomSlots(next);
    if (!check.ok) {
      await fail(
        check.reason === "overlap"
          ? "supportList.overlap"
          : check.reason === "duplicate"
            ? "supportList.invalidTimes"
            : "supportList.retentionLimit",
      );
      return;
    }
    await saveCustomSlots(deps, next);
    await finish(await slotsView(deps, language));
    return;
  }
  if (draft.kind === "slotKeep") {
    const minutes = parseRetentionMinutes(text);
    if (minutes === null) {
      await fail("supportList.retentionLimit");
      return;
    }
    const time = parseClock(draft.time);
    if (!time) {
      await fail("supportList.invalidTimes");
      return;
    }
    const settings = await ensureSettings(deps.prisma, deps.getRecord().id);
    const slots = readCustomSlots(settings.customTimes, settings.retentionMinutes);
    const next =
      draft.index === null
        ? [...slots, { time, retentionMinutes: minutes }]
        : slots.map((slot, index) =>
            index === draft.index ? { time, retentionMinutes: minutes } : slot,
          );
    const check = validateCustomSlots(next);
    if (!check.ok) {
      await fail(
        check.reason === "overlap"
          ? "supportList.overlap"
          : check.reason === "duplicate"
            ? "supportList.invalidTimes"
            : check.reason === "count"
              ? "supportList.maxSlots"
              : "supportList.retentionLimit",
      );
      return;
    }
    await saveCustomSlots(deps, next);
    await finish(await slotsView(deps, language));
    return;
  }
  if (draft.kind === "timeZone") {
    if (!isValidTimeZone(text)) {
      await fail("supportList.invalidTimeZone");
      return;
    }
    await deps.prisma.supportListSettings.update({
      where: { botId: deps.getRecord().id },
      data: { timeZone: text },
    });
    await replaceUnstartedCycles(deps.prisma, deps.getRecord().id);
    await finish(await scheduleView(deps, language));
    return;
  }
  if (draft.kind !== "adminReason") {
    return;
  }
  const reason = text.replace(/\s+/g, " ").trim();
  if (reason.length < 1 || reason.length > ADMIN_REASON_LIMIT) {
    await fail("supportList.invalidReason");
    return;
  }
  const before = await getMembershipForBot(
    deps.prisma,
    deps.getRecord().id,
    draft.membershipId,
  );
  const updated = await disableByAdmin(
    deps.prisma,
    deps.getRecord().id,
    draft.membershipId,
    reason,
  );
  if (updated && before && Number(before.addedBy.telegramId) !== context.from.id) {
    await notifyUser(
      deps,
      Number(before.addedBy.telegramId),
      before.addedByUserId,
      "supportList.adminDisabledNotice",
      { title: before.channel.title ?? before.id, reason },
    );
  }
  const scope = (["m", "a", "p", "r"] as const).includes(draft.scope as ListScope)
    ? (draft.scope as ListScope)
    : "a";
  await finish(
    updated && before
      ? buildMembershipDetail({
          language,
          title: before.channel.title ?? before.channel.username ?? updated.id,
          status: translate(language, "supportList.statusDisabled"),
          membershipId: updated.id,
          page: draft.page,
          scope,
          flags: {
            participantDisabled: updated.participantDisabled,
            adminDisabled: updated.adminDisabled,
            adminDisableReason: updated.adminDisableReason,
            permissionsLost: updated.permissionsLost,
            inviteUnavailable: updated.inviteUnavailable,
          },
          pendingReview: updated.acceptanceStatus === "PENDING",
        })
      : await adminView(deps, language),
  );
}
