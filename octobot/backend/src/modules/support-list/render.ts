import {
  BUTTON_LABEL_LIMIT,
  TELEGRAM_TEXT_LIMIT,
} from "./constants.js";

export interface ListEntry {
  id: string;
  title: string;
  url: string;
}

export interface RenderedList {
  text: string;
  buttons: { label: string; url: string }[] | null;
  memberIds: string[];
}

export function rotateEntries<T>(entries: T[], offset: number): T[] {
  if (entries.length === 0) {
    return [];
  }
  const index =
    ((offset % entries.length) + entries.length) % entries.length;
  return [...entries.slice(index), ...entries.slice(0, index)];
}

export function nextRotationOffset(
  offset: number,
  count: number,
): number {
  if (count <= 0) {
    return 0;
  }
  return (((offset % count) + count) % count + 1) % count;
}

export function channelDisplayName(input: {
  title?: string | null;
  username?: string | null;
  channelTelegramId: bigint | number | string;
}): string {
  const title = input.title?.replace(/\s+/g, " ").trim();
  if (title) {
    return title;
  }
  if (input.username) {
    return `@${input.username}`;
  }
  return String(input.channelTelegramId);
}

export function buttonLabel(title: string): string {
  const clean = title.replace(/\s+/g, " ").trim() || "Channel";
  const chars = Array.from(clean);
  if (chars.length <= BUTTON_LABEL_LIMIT) {
    return clean;
  }
  return `${chars.slice(0, BUTTON_LABEL_LIMIT - 1).join("")}…`;
}

export function renderSupportList(input: {
  listName: string;
  entries: ListEntry[];
  format: "TEXT" | "BUTTONS";
}):
  | { ok: true; rendered: RenderedList }
  | { ok: false; reason: "empty" | "unfit" } {
  if (input.entries.length === 0) {
    return { ok: false, reason: "empty" };
  }
  if (
    input.entries.some(
      (entry) => !entry.url.startsWith("https://") || entry.url.length > 2048,
    )
  ) {
    return { ok: false, reason: "unfit" };
  }
  const memberIds = input.entries.map((entry) => entry.id);
  if (input.format === "BUTTONS") {
    if (input.listName.length === 0 || input.listName.length > TELEGRAM_TEXT_LIMIT) {
      return { ok: false, reason: "unfit" };
    }
    return {
      ok: true,
      rendered: {
        text: input.listName,
        buttons: input.entries.map((entry) => ({
          label: buttonLabel(entry.title),
          url: entry.url,
        })),
        memberIds,
      },
    };
  }

  const lines = [input.listName, ""];
  for (const entry of input.entries) {
    const title = entry.title.replace(/\s+/g, " ").trim() || entry.url;
    lines.push(`${title} — ${entry.url}`);
  }
  const text = lines.join("\n");
  if (text.length > TELEGRAM_TEXT_LIMIT) {
    return { ok: false, reason: "unfit" };
  }
  return {
    ok: true,
    rendered: { text, buttons: null, memberIds },
  };
}

export function parseRenderedList(value: unknown): RenderedList | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  if (typeof record.text !== "string" || !Array.isArray(record.memberIds)) {
    return null;
  }
  const memberIds = record.memberIds.filter(
    (item): item is string => typeof item === "string",
  );
  if (memberIds.length !== record.memberIds.length) {
    return null;
  }
  if (record.buttons === null || record.buttons === undefined) {
    return { text: record.text, buttons: null, memberIds };
  }
  if (!Array.isArray(record.buttons)) {
    return null;
  }
  const buttons: { label: string; url: string }[] = [];
  for (const button of record.buttons) {
    if (
      !button ||
      typeof button !== "object" ||
      typeof (button as { label?: unknown }).label !== "string" ||
      typeof (button as { url?: unknown }).url !== "string"
    ) {
      return null;
    }
    buttons.push({
      label: (button as { label: string }).label,
      url: (button as { url: string }).url,
    });
  }
  return { text: record.text, buttons, memberIds };
}
