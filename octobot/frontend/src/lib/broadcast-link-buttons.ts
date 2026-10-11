export type LinkButtonPlacement = "new_row" | "after_previous";

export type LinkButtonColor = "default" | "blue" | "green" | "red";

export type TelegramLinkButtonStyle = "primary" | "success" | "danger";

export interface LinkButtonEditorEntry {
  text: string;
  url: string;
  placement: LinkButtonPlacement;
  color: LinkButtonColor;
}

export interface LinkButtonPayloadCell {
  text: string;
  url: string;
  style?: TelegramLinkButtonStyle;
}

export function editorColorToStyle(color: LinkButtonColor): TelegramLinkButtonStyle | undefined {
  switch (color) {
    case "blue":
      return "primary";
    case "green":
      return "success";
    case "red":
      return "danger";
    default:
      return undefined;
  }
}

export function buildLinkButtonRows(
  buttons: LinkButtonEditorEntry[],
): LinkButtonPayloadCell[][] | null {
  const rows: LinkButtonPayloadCell[][] = [];
  for (const button of buttons) {
    const text = button.text.trim();
    const url = button.url.trim();
    if (!text || !url) {
      continue;
    }
    const style = editorColorToStyle(button.color);
    const cell: LinkButtonPayloadCell = style ? { text, url, style } : { text, url };
    if (button.placement === "after_previous" && rows.length > 0) {
      rows[rows.length - 1].push(cell);
    } else {
      rows.push([cell]);
    }
  }
  return rows.length > 0 ? rows : null;
}
