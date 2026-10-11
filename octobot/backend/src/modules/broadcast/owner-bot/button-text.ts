import { parseLinkButtons, type LinkButtonMatrix } from "../content.js";

const STYLE_SUFFIX = /\s+-\s+style:(green|blue|red)\s*$/i;

export type ParseOwnerButtonsResult =
  | { ok: true; rows: LinkButtonMatrix }
  | { ok: false; reason: string };

function parseCell(segment: string): { text: string; url: string; style?: string } | null {
  const trimmed = segment.trim();
  if (!trimmed) {
    return null;
  }
  let styleToken: string | undefined;
  let body = trimmed;
  const styleMatch = STYLE_SUFFIX.exec(trimmed);
  if (styleMatch) {
    styleToken = styleMatch[1].toLowerCase();
    body = trimmed.slice(0, styleMatch.index).trimEnd();
  }
  const httpsIndex = body.indexOf("https://");
  if (httpsIndex < 0) {
    return null;
  }
  const url = body.slice(httpsIndex).trim();
  const labelPart = body.slice(0, httpsIndex).trimEnd();
  if (!labelPart.endsWith("-")) {
    return null;
  }
  const text = labelPart.slice(0, -1).trimEnd();
  if (!text || !url) {
    return null;
  }
  const style =
    styleToken === "green"
      ? "success"
      : styleToken === "blue"
        ? "primary"
        : styleToken === "red"
          ? "danger"
          : undefined;
  return style ? { text, url, style } : { text, url };
}

export function parseOwnerBroadcastButtonText(input: string): ParseOwnerButtonsResult {
  const lines = input.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (lines.length === 0) {
    return { ok: false, reason: "empty" };
  }
  const rawRows: Array<Array<{ text: string; url: string; style?: string }>> = [];
  for (const line of lines) {
    const parts = line.split(/\s+\|\s+/);
    const row: Array<{ text: string; url: string; style?: string }> = [];
    for (const part of parts) {
      const cell = parseCell(part);
      if (!cell) {
        return { ok: false, reason: "invalid_cell" };
      }
      row.push(cell);
    }
    rawRows.push(row);
  }
  const parsed = parseLinkButtons({ rows: rawRows });
  if (!parsed) {
    return { ok: false, reason: "validation_failed" };
  }
  return { ok: true, rows: parsed };
}
