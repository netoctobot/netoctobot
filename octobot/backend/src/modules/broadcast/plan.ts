export interface BroadcastScope {
  includeActive: boolean;
  includeInactive: boolean;
  includeDeleted: boolean;
}

export interface PlanBot {
  id: string;
  isActive: boolean;
  deletedAt: Date | null;
}

export interface PlanChannel {
  id: string;
  title: string | null;
  username: string | null;
  telegramId: string;
  deletedAt: Date | null;
}

export interface PlanLink {
  botId: string;
  channelId: string;
}

export interface PlanMembership {
  botId: string;
  channelId: string;
  deletedAt: Date | null;
}

export interface IncludedChannel {
  channelId: string;
  title: string | null;
  username: string | null;
  telegramId: string;
  botIds: string[];
}

export interface ExcludedChannel {
  channelId: string;
  title: string | null;
  reason: string;
}

export function botMatchesScope(bot: PlanBot, scope: BroadcastScope): boolean {
  if (bot.deletedAt) {
    return scope.includeDeleted;
  }
  return bot.isActive ? scope.includeActive : scope.includeInactive;
}

export function collectBroadcastChannels(input: {
  bots: PlanBot[];
  selectedIds: string[] | null;
  scope: BroadcastScope;
  links: PlanLink[];
  memberships: PlanMembership[];
  channels: PlanChannel[];
}): { included: IncludedChannel[]; excluded: ExcludedChannel[] } {
  const channelById = new Map(input.channels.map((channel) => [channel.id, channel]));
  const selected = new Set(input.selectedIds ?? input.bots.map((bot) => bot.id));
  const inScope = new Set(
    input.bots.filter((bot) => selected.has(bot.id) && botMatchesScope(bot, input.scope)).map((bot) => bot.id),
  );
  const includedBots = new Map<string, Set<string>>();
  const touched = new Map<string, { deleted: boolean; outOfScope: boolean }>();

  function note(channelId: string, botId: string, deleted: boolean): void {
    const current = touched.get(channelId) ?? { deleted: false, outOfScope: false };
    if (!selected.has(botId)) {
      return;
    }
    if (!inScope.has(botId)) {
      current.outOfScope = true;
      touched.set(channelId, current);
      return;
    }
    if (deleted && !input.scope.includeDeleted) {
      current.deleted = true;
      touched.set(channelId, current);
      return;
    }
    const bots = includedBots.get(channelId) ?? new Set<string>();
    bots.add(botId);
    includedBots.set(channelId, bots);
    touched.set(channelId, current);
  }

  for (const link of input.links) {
    const channel = channelById.get(link.channelId);
    note(link.channelId, link.botId, Boolean(channel?.deletedAt));
  }
  for (const membership of input.memberships) {
    const channel = channelById.get(membership.channelId);
    note(
      membership.channelId,
      membership.botId,
      Boolean(membership.deletedAt) || Boolean(channel?.deletedAt),
    );
  }

  const included: IncludedChannel[] = [];
  const excluded: ExcludedChannel[] = [];
  for (const [channelId, meta] of touched) {
    const channel = channelById.get(channelId);
    const title = channel?.title ?? null;
    const bots = includedBots.get(channelId);
    if (bots && bots.size > 0) {
      included.push({
        channelId,
        title,
        username: channel?.username ?? null,
        telegramId: channel?.telegramId ?? "",
        botIds: [...bots].sort(),
      });
      continue;
    }
    excluded.push({
      channelId,
      title,
      reason: meta.deleted ? "deleted" : "bot_out_of_scope",
    });
  }
  included.sort((left, right) => left.channelId.localeCompare(right.channelId));
  excluded.sort((left, right) => left.channelId.localeCompare(right.channelId));
  return { included, excluded };
}

export type ProbeResult =
  | { ok: true }
  | { ok: false; reason: "invalid_token" | "not_admin" | "no_post_permission" | "unavailable" };

export interface EligibleChannel extends IncludedChannel {
  botId: string;
}

export async function assignSenders(
  channels: IncludedChannel[],
  probe: (botId: string, channelId: string) => Promise<ProbeResult>,
): Promise<{ eligible: EligibleChannel[]; excluded: ExcludedChannel[] }> {
  const eligible: EligibleChannel[] = [];
  const excluded: ExcludedChannel[] = [];
  for (const channel of channels) {
    let failure: ProbeResult | null = null;
    let sender: string | null = null;
    for (const botId of channel.botIds) {
      const result = await probe(botId, channel.channelId);
      if (result.ok) {
        sender = botId;
        break;
      }
      if (!failure || result.reason === "unavailable") {
        failure = result;
      }
    }
    if (sender) {
      eligible.push({ ...channel, botId: sender });
    } else {
      excluded.push({
        channelId: channel.channelId,
        title: channel.title,
        reason: failure && !failure.ok ? failure.reason : "not_admin",
      });
    }
  }
  return { eligible, excluded };
}

export function canPublishAsAdmin(member: {
  status: string;
  can_post_messages?: boolean;
}): boolean {
  if (member.status === "creator") {
    return true;
  }
  return member.status === "administrator" && member.can_post_messages === true;
}

export type DeliveryTransition =
  | { send: false; status: "SENT" | "EXCLUDED" | "UNCERTAIN" | "FAILED" | "STOPPED" | "PENDING" }
  | { send: true; status: "PENDING" };

export function nextDelivery(
  status: string,
  stopRequested: boolean,
): DeliveryTransition {
  if (status !== "PENDING") {
    return { send: false, status: status as "SENT" };
  }
  if (stopRequested) {
    return { send: false, status: "STOPPED" };
  }
  return { send: true, status: "PENDING" };
}

export function classifySendError(error: unknown):
  | { action: "retry"; delayMs: number }
  | { action: "failed"; reason: string }
  | { action: "uncertain" } {
  const record = error && typeof error === "object" ? (error as { error_code?: unknown; description?: unknown; message?: unknown; parameters?: { retry_after?: number } }) : {};
  const code = Number(record.error_code);
  if (code === 429) {
    const retryAfter = record.parameters?.retry_after;
    return { action: "retry", delayMs: (retryAfter && retryAfter > 0 ? retryAfter : 1) * 1000 };
  }
  if (code === 400 || code === 403) {
    return { action: "failed", reason: "telegram_rejected" };
  }
  return { action: "uncertain" };
}
