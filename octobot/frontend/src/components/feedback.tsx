"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { useLocale, useTranslations } from "next-intl";
import { errorKey } from "@/lib/api";
import { formatNumber } from "@/lib/format";

export function Alert({
  code,
  tone = "error",
}: {
  code: string | null;
  tone?: "error" | "saved";
}) {
  const t = useTranslations();
  if (!code) {
    return null;
  }
  const message = tone === "saved" ? t("alerts.saved") : t(errorKey(code));
  return (
    <p
      role={tone === "error" ? "alert" : "status"}
      className={`rounded-xl px-3 py-2 text-sm ${
        tone === "error" ? "bg-[#f6ddd4] text-ink" : "bg-[#e5efe4] text-ink"
      }`}
    >
      {message}
    </p>
  );
}

export function PageState({
  loading,
  error,
  empty,
  onRetry,
}: {
  loading: boolean;
  error: string | null;
  empty?: boolean;
  onRetry?: () => void;
}) {
  const t = useTranslations("common");
  if (loading) {
    return <p className="text-muted">{t("loading")}</p>;
  }
  if (error) {
    return (
      <div className="flex flex-col items-start gap-3">
        <Alert code={error} />
        {onRetry ? (
          <button
            type="button"
            onClick={onRetry}
            className="rounded-full bg-ink px-4 py-2 text-sm text-card"
          >
            {t("retry")}
          </button>
        ) : null}
      </div>
    );
  }
  if (empty) {
    return <p className="text-muted">{t("empty")}</p>;
  }
  return null;
}

export function Pager({
  page,
  pageCount,
  onPage,
}: {
  page: number;
  pageCount: number;
  onPage: (page: number) => void;
}) {
  const t = useTranslations("common");
  const locale = useLocale();
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <button
        type="button"
        disabled={page <= 1}
        onClick={() => onPage(page - 1)}
        className="rounded-full border border-line px-3 py-1.5 text-sm disabled:opacity-40"
      >
        {t("previous")}
      </button>
      <span className="text-sm text-muted">
        {t("pageStatus", {
          page: formatNumber(locale, page),
          pages: formatNumber(locale, pageCount),
        })}
      </span>
      <button
        type="button"
        disabled={page >= pageCount}
        onClick={() => onPage(page + 1)}
        className="rounded-full border border-line px-3 py-1.5 text-sm disabled:opacity-40"
      >
        {t("next")}
      </button>
    </div>
  );
}

export function DataTable({
  headers,
  children,
}: {
  headers: string[];
  children: ReactNode;
}) {
  return (
    <div className="overflow-x-auto rounded-2xl border border-line bg-card">
      <table className="w-full border-collapse text-start text-sm">
        <thead>
          <tr className="bg-[#f6f0e6] text-muted">
            {headers.map((header, index) => (
              <th
                key={`${header}-${index}`}
                scope="col"
                className="px-3 py-3 font-medium"
              >
                {header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

export function DataRow({ children }: { children: ReactNode }) {
  return <tr className="border-t border-line align-top">{children}</tr>;
}

export function DataCell({ children }: { children: ReactNode }) {
  return (
    <td className="px-3 py-3">
      <div className="flex flex-col items-start gap-1">{children}</div>
    </td>
  );
}

export function Dialog({
  open,
  title,
  onClose,
  children,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const t = useTranslations("common");
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) {
      panel.current?.focus();
    }
  }, [open]);

  useEffect(() => {
    if (!open) {
      return;
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#172421]/45 p-4">
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby="dialog-title"
        tabIndex={-1}
        className="w-full max-w-lg rounded-3xl border border-line bg-card text-ink outline-none"
      >
        <div className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
          <h2 id="dialog-title" className="text-lg font-semibold">
            {title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full border border-line px-3 py-1 text-sm"
          >
            {t("close")}
          </button>
        </div>
        <div className="px-5 py-4">{children}</div>
      </div>
    </div>
  );
}
