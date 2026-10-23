import { assertDistinctLabDatabase } from "./database-target.js";
import { LAB_LIMITS } from "./policy.js";

/**
 * Lab settings come from backend/.env.lab through the cpm-lab service
 * environment. Errors name the variable and never include its value.
 */
export class LabConfigError extends Error {
  constructor(readonly key: string, reason: string) {
    super(`${key} ${reason}. The value was not shown.`);
    this.name = "LabConfigError";
  }
}

export type LabEnv = Record<string, string | undefined>;

export type TelegramCredentials = { apiId: number; apiHash: string };

export type LabChannelConfig = {
  telegramChannelId: bigint;
  postId: number;
  username: string | null;
  inviteHash: string | null;
};

export type LabTrialConfig = { rounds: number; intervalMs: number };

export function labDatabaseUrl(env: LabEnv): string {
  return assertDistinctLabDatabase(env);
}

export function telegramCredentials(env: LabEnv): TelegramCredentials {
  const apiIdRaw = required(env, "LAB_API_ID");
  if (!/^[1-9]\d{0,11}$/.test(apiIdRaw)) {
    throw new LabConfigError("LAB_API_ID", "must be a positive integer");
  }
  const apiHash = required(env, "LAB_API_HASH");
  if (!/^[0-9a-f]{32}$/i.test(apiHash)) {
    throw new LabConfigError("LAB_API_HASH", "must be 32 hex characters");
  }
  return { apiId: Number(apiIdRaw), apiHash };
}

export function sessionKey(env: LabEnv): string {
  const key = required(env, "LAB_SESSION_ENCRYPTION_KEY");
  if (!/^[0-9a-f]{64}$/i.test(key)) {
    throw new LabConfigError("LAB_SESSION_ENCRYPTION_KEY", "must be 64 hex characters");
  }
  return key;
}

export function botToken(env: LabEnv): string {
  const token = required(env, "LAB_BOT_TOKEN");
  if (!/^\d{5,12}:[A-Za-z0-9_-]{30,}$/.test(token)) {
    throw new LabConfigError("LAB_BOT_TOKEN", "does not look like a BotFather token");
  }
  return token;
}

export function channelConfig(env: LabEnv): LabChannelConfig {
  const channelRaw = required(env, "LAB_CHANNEL_ID");
  const match = channelRaw.match(/^(?:-100)?([1-9]\d{0,15})$/);
  if (!match?.[1]) {
    throw new LabConfigError(
      "LAB_CHANNEL_ID",
      "must be a channel id, either bare or in the -100 Bot API form",
    );
  }
  const postRaw = required(env, "LAB_POST_ID");
  if (!/^[1-9]\d{0,9}$/.test(postRaw) || Number(postRaw) > 2_147_483_647) {
    throw new LabConfigError("LAB_POST_ID", "must be one positive message id");
  }
  const username = optional(env, "LAB_CHANNEL_USERNAME");
  if (username !== null && !/^@?[A-Za-z][A-Za-z0-9_]{3,31}$/.test(username)) {
    throw new LabConfigError("LAB_CHANNEL_USERNAME", "is not a valid public username");
  }
  const invite = optional(env, "LAB_CHANNEL_INVITE_LINK");
  const inviteHash = invite === null ? null : parseInviteHash(invite);
  return {
    telegramChannelId: BigInt(match[1]),
    postId: Number(postRaw),
    username: username === null ? null : username.replace(/^@/, ""),
    inviteHash,
  };
}

export function trialConfig(env: LabEnv): LabTrialConfig {
  const rounds = integerOr(env, "LAB_TRIAL_ROUNDS", 12);
  if (rounds < 1 || rounds > LAB_LIMITS.maxRounds) {
    throw new LabConfigError("LAB_TRIAL_ROUNDS", `must be between 1 and ${LAB_LIMITS.maxRounds}`);
  }
  const intervalSeconds = integerOr(env, "LAB_TRIAL_INTERVAL_SECONDS", 300);
  if (intervalSeconds * 1000 < LAB_LIMITS.minIntervalMs || intervalSeconds > 3_600) {
    throw new LabConfigError("LAB_TRIAL_INTERVAL_SECONDS", "must be between 60 and 3600");
  }
  return { rounds, intervalMs: intervalSeconds * 1000 };
}

export function parseInviteHash(value: string): string {
  const trimmed = value.trim();
  const match = trimmed.match(
    /^(?:https?:\/\/)?(?:t\.me|telegram\.me)\/(?:\+|joinchat\/)([A-Za-z0-9_-]{8,64})\/?$/,
  );
  if (!match?.[1]) {
    throw new LabConfigError(
      "LAB_CHANNEL_INVITE_LINK",
      "must be a t.me/+hash or t.me/joinchat/hash link",
    );
  }
  return match[1];
}

/** Values that the lab redacts from any log line it writes. */
export function labSecrets(env: LabEnv): string[] {
  const values = [
    "LAB_API_HASH",
    "LAB_BOT_TOKEN",
    "LAB_SESSION_ENCRYPTION_KEY",
    "LAB_DATABASE_URL",
    "LAB_TEST_DATABASE_URL",
    "LAB_CHANNEL_INVITE_LINK",
    "LAB_POSTGRES_PASSWORD",
  ]
    .map((key) => env[key])
    .filter((value): value is string => typeof value === "string" && value !== "");
  for (const key of ["LAB_DATABASE_URL", "LAB_TEST_DATABASE_URL"]) {
    const password = urlPassword(env[key]);
    if (password) values.push(password, encodeURIComponent(password));
  }
  return values;
}

function urlPassword(value: string | undefined): string | null {
  if (!value) return null;
  try {
    const password = decodeURIComponent(new URL(value).password);
    return password === "" ? null : password;
  } catch {
    return null;
  }
}

function required(env: LabEnv, key: string): string {
  const value = env[key]?.trim();
  if (value === undefined || value === "") {
    throw new LabConfigError(key, "is required");
  }
  return value;
}

function optional(env: LabEnv, key: string): string | null {
  const value = env[key]?.trim();
  return value === undefined || value === "" ? null : value;
}

function integerOr(env: LabEnv, key: string, fallback: number): number {
  const value = optional(env, key);
  if (value === null) {
    return fallback;
  }
  if (!/^\d{1,6}$/.test(value)) {
    throw new LabConfigError(key, "must be a whole number");
  }
  return Number(value);
}
