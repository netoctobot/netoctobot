"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { telegramLink } from "@/lib/api";

export function UserContent({ value }: { value: string | null | undefined }) {
  const t = useTranslations("common");
  if (!value) {
    return <span className="text-muted">{t("none")}</span>;
  }
  return <span dir="auto">{value}</span>;
}

export function CopyValue({
  value,
  label,
}: {
  value: string;
  label: string;
}) {
  const t = useTranslations();
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");

  async function copy() {
    let copied = false;
    try {
      await navigator.clipboard.writeText(value);
      copied = true;
    } catch {
      const area = document.createElement("textarea");
      area.value = value;
      area.setAttribute("readonly", "true");
      document.body.append(area);
      area.select();
      copied = document.execCommand("copy");
      area.remove();
    }
    setState(copied ? "copied" : "failed");
    window.setTimeout(() => setState("idle"), 1600);
  }

  return (
    <span className="inline-flex max-w-full flex-wrap items-center gap-2">
      <span dir="ltr" className="[unicode-bidi:isolate] break-all">
        {value}
      </span>
      <button
        type="button"
        onClick={() => void copy()}
        aria-label={t("copy.actionFor", { label })}
        className="rounded-full border border-line bg-paper px-2 py-0.5 text-xs text-ink"
      >
        {t("copy.action")}
      </button>
      <span role="status" className="text-xs text-muted">
        {state === "copied"
          ? t("alerts.copied")
          : state === "failed"
            ? t("alerts.copyFailed")
            : ""}
      </span>
    </span>
  );
}

export function UsernameValue({ username }: { username: string | null }) {
  const t = useTranslations();
  const link = telegramLink(username);
  if (!username) {
    return <UserContent value={null} />;
  }
  return (
    <span className="inline-flex flex-col items-start gap-1">
      <CopyValue value={username} label={t("copy.username")} />
      {link ? (
        <a
          href={link}
          dir="ltr"
          className="[unicode-bidi:isolate] text-action underline"
          rel="noreferrer"
        >
          {link}
        </a>
      ) : null}
    </span>
  );
}

export function Person({
  firstName,
  lastName,
  username,
  telegramId,
}: {
  firstName: string | null;
  lastName?: string | null;
  username: string | null;
  telegramId: string;
}) {
  const t = useTranslations();
  const name = [firstName, lastName].filter(Boolean).join(" ");
  return (
    <span className="flex flex-col items-start gap-1">
      <UserContent value={name || null} />
      <UsernameValue username={username} />
      <CopyValue value={telegramId} label={t("copy.id")} />
    </span>
  );
}
