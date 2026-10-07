import { DEFAULT_LIST_NAME, LEGACY_LIST_NAME } from "./constants.js";

const TELEGRAM_HTTP =
  /^https:\/\/t\.me\/[A-Za-z0-9_+][A-Za-z0-9_+\-/]{0,200}$/i;
const TELEGRAM_SCHEME = /^tg:\/\/[A-Za-z0-9_?=&.+\-/]{1,200}$/;
const USERNAME = /^@[A-Za-z0-9_]{4,32}$/;

export function parseContactUrl(text: string): string | null {
  const value = text.trim();
  if (USERNAME.test(value)) {
    return `https://t.me/${value.slice(1)}`;
  }
  if (TELEGRAM_HTTP.test(value) || TELEGRAM_SCHEME.test(value)) {
    return value;
  }
  return null;
}

export function parseListName(text: string): string | null {
  const value = text.replace(/\s+/g, " ").trim();
  if (value.length < 1 || value.length > 64) {
    return null;
  }
  return value;
}

export function displayedListName(stored: string | null | undefined): string {
  const value = stored?.replace(/\s+/g, " ").trim() ?? "";
  if (!value || value === LEGACY_LIST_NAME) {
    return DEFAULT_LIST_NAME;
  }
  return value;
}
