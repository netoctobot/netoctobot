export interface UserRef {
  id: string;
  telegramId: string;
  username: string | null;
  firstName: string | null;
}

export interface PublicUser extends UserRef {
  lastName: string | null;
}

export interface Page<T> {
  items: T[];
  page: number;
  pageCount: number;
  total: number;
}

export interface DashboardAdminRef {
  id: string;
  username: string;
}

export interface Me {
  admin: DashboardAdminRef;
  webLocale: "AR" | "EN" | null;
}

export interface LoginResult {
  admin: DashboardAdminRef;
  webLocale: "AR" | "EN" | null;
}

export interface Overview {
  users: number;
  bots: number;
  channels: number;
  activeCycles: number;
  catalogChannels: number;
}

export interface UserRow {
  id: string;
  telegramId: string;
  username: string | null;
  firstName: string | null;
  lastName: string | null;
  createdAt: string;
  deletedAt: string | null;
}

export interface BotRow {
  id: string;
  botUsername: string;
  botType: string;
  isActive: boolean;
  deletedAt: string | null;
  allowPlatformForced: boolean;
  owner: UserRef;
  activeLinkCount: number;
}

export interface BotDetail extends BotRow {
  createdAt: string;
  welcomeMessages: Record<string, string>;
  footerTexts: Record<string, string>;
  links: Array<{
    id: string;
    status: string;
    deactivationReason: string | null;
    channel: {
      id: string;
      title: string | null;
      username: string | null;
      telegramId: string;
      isActive: boolean;
      deletedAt: string | null;
    };
  }>;
  supportList: {
    listName: string;
    timeZone: string;
    publishingEnabled: boolean;
    scheduleMode: string;
    retentionMinutes: number;
    acceptanceMode: string;
    format: string;
    contactUrl: string | null;
    customTimes: string[];
  } | null;
}

export interface ChannelRow {
  id: string;
  title: string | null;
  username: string | null;
  telegramId: string;
  memberCount: number;
  isPlatformCatalog: boolean;
  isActive: boolean;
  deletedAt: string | null;
  owner: UserRef | null;
}

export interface ChannelDetail extends ChannelRow {
  deactivationReason: string | null;
  addedAt: string;
  links: Array<{
    id: string;
    status: string;
    deactivationReason: string | null;
    bot: {
      id: string;
      botUsername: string;
      botType: string;
      deletedAt: string | null;
    };
  }>;
}

export interface PublishingRow {
  id: string;
  botUsername: string;
  isActive: boolean;
  deletedAt: string | null;
  listName: string | null;
  timeZone: string | null;
  publishingEnabled: boolean | null;
  scheduleMode: string | null;
  nextSlot: { scheduledAt: string; deleteAt: string } | null;
}

export interface PublishingDetail {
  id: string;
  botUsername: string;
  isActive: boolean;
  deletedAt: string | null;
  settings: {
    listName: string;
    timeZone: string;
    publishingEnabled: boolean;
    scheduleMode: string;
    retentionMinutes: number;
    acceptanceMode: string;
    format: string;
    contactUrl: string | null;
    customTimes: string[];
  } | null;
  memberships: Array<{
    id: string;
    acceptanceStatus: string;
    participantDisabled: boolean;
    adminDisabled: boolean;
    adminDisableReason: string | null;
    permissionsLost: boolean;
    inviteUnavailable: boolean;
    deletedAt: string | null;
    channel: {
      id: string;
      title: string | null;
      username: string | null;
      telegramId: string;
    };
  }>;
  cycles: Array<{
    id: string;
    scheduledAt: string;
    deleteAt: string;
    status: string;
    publications: Array<{
      id: string;
      status: string;
      messageId: string | null;
      deleteAt: string;
      channel: {
        title: string | null;
        username: string | null;
        telegramId: string;
      };
    }>;
  }>;
}

export interface CatalogItem {
  id: string;
  isActive: boolean;
  sortOrder: number;
  channel: {
    id: string;
    title: string | null;
    username: string | null;
    telegramId: string;
    deletedAt: string | null;
  };
}

export interface ForcedSubscriptionRow {
  id: string;
  createdAt: string;
  bot: { id: string; botUsername: string; botType: string };
  channel: {
    id: string;
    title: string | null;
    username: string | null;
    telegramId: string;
  };
  addedBy: UserRef;
}

export interface AuditRow {
  id: string;
  action: string;
  entityType: string | null;
  entityId: string | null;
  details: unknown;
  createdAt: string;
  actor: UserRef | null;
}

export interface BroadcastBotOption {
  id: string;
  botUsername: string;
  botType: string;
  isActive: boolean;
  deletedAt: string | null;
}

export interface BroadcastPreview {
  text: string;
  eligible: Array<{
    channelId: string;
    title: string | null;
    username: string | null;
    botId: string;
  }>;
  excluded: Array<{
    channelId: string;
    title: string | null;
    username?: string | null;
    reason: string;
  }>;
}

export interface BroadcastCampaign {
  id: string;
  text: string;
  status: string;
  targetMode: string;
  createdAt: string;
  stopRequested: boolean;
  counts: Record<string, number>;
}

export interface BroadcastDetail extends BroadcastCampaign {
  includeActive: boolean;
  includeInactive: boolean;
  includeDeleted: boolean;
  createdByAdmin: string;
  deliveries: Array<{
    id: string;
    status: string;
    reason: string | null;
    messageId: string | null;
    title: string | null;
    username: string | null;
  }>;
}
