import { createHash, createHmac, timingSafeEqual } from "node:crypto";

const MAX_AGE_SECONDS = 86_400;
const FUTURE_SKEW_SECONDS = 30;

export interface TelegramLoginData {
  id: string;
  first_name: string;
  last_name?: string;
  username?: string;
  photo_url?: string;
  auth_date: string;
  hash: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function decimalField(value: unknown): string | undefined {
  if (typeof value === "string" && /^[1-9]\d*$/.test(value)) {
    return value;
  }
  if (typeof value === "number" && Number.isSafeInteger(value) && value > 0) {
    return String(value);
  }
  return undefined;
}

function optionalText(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? value : undefined;
}

export function parseTelegramLoginBody(
  body: unknown,
): TelegramLoginData | null {
  if (!isRecord(body)) {
    return null;
  }
  const id = decimalField(body.id);
  const authDate = decimalField(body.auth_date);
  const hash = typeof body.hash === "string" ? body.hash.toLowerCase() : "";
  const firstName = typeof body.first_name === "string" ? body.first_name : "";
  if (!id || !authDate || !/^[0-9a-f]{64}$/.test(hash) || firstName.length < 1) {
    return null;
  }
  const data: TelegramLoginData = {
    id,
    auth_date: authDate,
    hash,
    first_name: firstName,
  };
  const lastName = optionalText(body.last_name);
  const username = optionalText(body.username);
  const photoUrl = optionalText(body.photo_url);
  if (lastName) {
    data.last_name = lastName;
  }
  if (username) {
    data.username = username;
  }
  if (photoUrl) {
    data.photo_url = photoUrl;
  }
  return data;
}

function dataCheckString(data: TelegramLoginData): string {
  const fields: Record<string, string> = {
    auth_date: data.auth_date,
    first_name: data.first_name,
    id: data.id,
  };
  if (data.last_name) {
    fields.last_name = data.last_name;
  }
  if (data.username) {
    fields.username = data.username;
  }
  if (data.photo_url) {
    fields.photo_url = data.photo_url;
  }
  return Object.keys(fields)
    .sort()
    .map((key) => `${key}=${fields[key]}`)
    .join("\n");
}

export function verifyTelegramLogin(
  data: TelegramLoginData,
  botToken: string,
  nowMs: number,
): boolean {
  const authDate = Number(data.auth_date);
  const ageSeconds = Math.floor(nowMs / 1000) - authDate;
  if (ageSeconds > MAX_AGE_SECONDS || ageSeconds < -FUTURE_SKEW_SECONDS) {
    return false;
  }
  const secret = createHash("sha256").update(botToken).digest();
  const digest = createHmac("sha256", secret)
    .update(dataCheckString(data))
    .digest("hex");
  const actual = Buffer.from(digest);
  const expected = Buffer.from(data.hash);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
