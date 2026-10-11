"use client";

import { useTranslations } from "next-intl";
import type { BroadcastContentPreview } from "@/lib/types";

export function BroadcastContentPreviewView({ content }: { content: BroadcastContentPreview }) {
  const t = useTranslations("broadcast");
  const mediaUrl = content.media ? `/admin-api${content.media.viewPath}` : null;

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-line bg-paper p-3">
      <p className="text-xs text-muted">
        {t("contentKindLabel")}: {t(`contentKind.${content.contentKind}`)}
      </p>
      {content.contentKind === "TEXT" && content.text ? (
        <p dir="auto" className="whitespace-pre-wrap text-sm">{content.text}</p>
      ) : null}
      {content.contentKind !== "TEXT" && mediaUrl ? (
        <div className="max-w-md">
          {content.contentKind === "PHOTO" || content.contentKind === "ANIMATION" ? (
            <img src={mediaUrl} alt="" className="max-h-64 rounded-lg object-contain" />
          ) : content.contentKind === "VIDEO" ? (
            <video src={mediaUrl} controls className="max-h-64 w-full rounded-lg" />
          ) : content.contentKind === "AUDIO" || content.contentKind === "VOICE" ? (
            <audio src={mediaUrl} controls className="w-full" />
          ) : (
            <a href={mediaUrl} className="text-sm text-action underline" target="_blank" rel="noreferrer">
              {t("openDocument")}
            </a>
          )}
        </div>
      ) : null}
      {content.caption ? (
        <p dir="auto" className="whitespace-pre-wrap text-sm">
          <span className="font-medium">{t("caption")}: </span>
          {content.caption}
        </p>
      ) : null}
      {content.linkButtons && content.linkButtons.length > 0 ? (
        <div className="flex flex-col gap-2">
          <p className="text-xs font-medium">{t("linkButtons")}</p>
          {content.linkButtons.map((row, rowIndex) => (
            <div key={rowIndex} className="flex flex-wrap gap-2">
              {row.map((button, buttonIndex) => (
                <span
                  key={`${rowIndex}-${buttonIndex}`}
                  className={`rounded-full border px-3 py-1 text-xs ${
                    button.style === "primary"
                      ? "border-blue-300 bg-blue-50"
                      : button.style === "success"
                        ? "border-green-300 bg-green-50"
                        : button.style === "danger"
                          ? "border-red-300 bg-red-50"
                          : "border-line bg-card"
                  }`}
                >
                  {button.text} → {button.url}
                </span>
              ))}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
