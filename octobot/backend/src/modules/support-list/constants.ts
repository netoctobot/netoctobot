export const MAX_ACCEPTED_CHANNELS = 30;
export const DEFAULT_RETENTION_MINUTES = 180;
export const MAX_RETENTION_MINUTES = 47 * 60;
export const MIN_RETENTION_MINUTES = 15;
export const CYCLE_GAP_MINUTES = 10;
export const TELEGRAM_TEXT_LIMIT = 4096;
export const BUTTON_LABEL_LIMIT = 64;
export const LIST_NAME_LIMIT = 64;
export const ADMIN_REASON_LIMIT = 200;
export const HORIZON_DAYS = 14;
export const DEFAULT_TIME_ZONE = "UTC";
export const MAX_CUSTOM_TIMES = 4;
export const PAGE_SIZE = 6;

export const TIME_ZONE_PRESETS = [
  "UTC",
  "Asia/Riyadh",
  "Africa/Cairo",
  "Asia/Dubai",
  "Europe/Istanbul",
  "Asia/Baghdad",
] as const;
