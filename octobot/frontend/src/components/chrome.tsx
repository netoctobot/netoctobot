"use client";

import { useLocale, useTranslations } from "next-intl";
import { ApiError, api, errorKey } from "@/lib/api";
import { appointmentParts, formatNumber } from "@/lib/format";
import { Link, usePathname, useRouter } from "@/i18n/navigation";
import type { ReactNode } from "react";
import { useEffect, useState } from "react";

const NAV = [
  ["/overview", "overview"],
  ["/users", "users"],
  ["/bots", "bots"],
  ["/channels", "channels"],
  ["/publishing", "publishing"],
  ["/catalog", "catalog"],
  ["/audit", "audit"],
] as const;

export function LocaleSwitcher({ signedIn }: { signedIn: boolean }) {
  const t = useTranslations("language");
  const errors = useTranslations();
  const locale = useLocale();
  const pathname = usePathname();
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  async function select(next: "ar" | "en") {
    if (next === locale) {
      return;
    }
    setError(null);
    if (signedIn) {
      try {
        await api("/locale", {
          method: "PUT",
          body: JSON.stringify({ language: next === "ar" ? "AR" : "EN" }),
        });
      } catch (caught) {
        setError(caught instanceof ApiError ? caught.code : "generic");
        return;
      }
    }
    router.replace(pathname, { locale: next });
  }

  return (
    <div className="flex flex-col items-start gap-1">
      <div
        role="group"
        aria-label={t("switchTo")}
        className="inline-flex rounded-full bg-paper p-1"
      >
        {(["ar", "en"] as const).map((choice) => (
          <button
            key={choice}
            type="button"
            aria-pressed={locale === choice}
            onClick={() => void select(choice)}
            className={`rounded-full px-3 py-1.5 text-sm ${
              locale === choice ? "bg-accent text-card" : "text-ink"
            }`}
          >
            {choice === "ar" ? t("arabic") : t("english")}
          </button>
        ))}
      </div>
      {error ? (
        <p role="alert" className="text-xs text-accent">
          {errors(errorKey(error))}
        </p>
      ) : null}
    </div>
  );
}

export function DashboardShell({ children }: { children: ReactNode }) {
  const t = useTranslations();
  const nav = useTranslations("nav");
  const locale = useLocale();
  const pathname = usePathname();
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api<{ webLocale: "AR" | "EN" | null }>("/me")
      .then((me) => {
        if (cancelled) {
          return;
        }
        const account = me.webLocale === "AR" ? "ar" : me.webLocale === "EN" ? "en" : null;
        if (account && account !== locale) {
          router.replace(pathname, { locale: account });
          return;
        }
        setReady(true);
      })
      .catch((caught: unknown) => {
        if (cancelled) {
          return;
        }
        if (
          caught instanceof ApiError &&
          (caught.status === 401 || caught.status === 403)
        ) {
          router.replace("/");
          return;
        }
        setError(caught instanceof ApiError ? caught.code : "generic");
      });
    return () => {
      cancelled = true;
    };
  }, [locale, pathname, router]);

  async function signOut() {
    await api("/session", { method: "DELETE" });
    router.replace("/");
  }

  const titleKey = NAV.find(
    ([href]) => pathname === href || pathname.startsWith(`${href}/`),
  )?.[1];

  return (
    <div className="grid min-h-screen md:grid-cols-[16rem_1fr]">
      <aside className="flex flex-col gap-6 bg-sidebar px-4 py-6 text-card">
        <p className="text-lg font-semibold">{t("brand")}</p>
        <nav aria-label={t("meta.title")} className="flex flex-col gap-1">
          {NAV.map(([href, key]) => {
            const active = pathname === href || pathname.startsWith(`${href}/`);
            return (
              <Link
                key={href}
                href={href}
                aria-current={active ? "page" : undefined}
                className={`rounded-xl px-3 py-2 text-sm ${
                  active ? "bg-accent text-card" : "text-card/90"
                }`}
              >
                {nav(key)}
              </Link>
            );
          })}
        </nav>
        <button
          type="button"
          onClick={() => void signOut()}
          className="mt-auto rounded-full border border-white/20 px-3 py-2 text-start text-sm"
        >
          {nav("signOut")}
        </button>
      </aside>
      <div className="min-w-0">
        <header className="flex flex-wrap items-center justify-between gap-4 border-b border-line px-5 py-4">
          <h1 className="text-2xl font-semibold">
            {titleKey ? nav(titleKey) : t("meta.title")}
          </h1>
          <LocaleSwitcher signedIn />
        </header>
        <main className="flex flex-col gap-5 px-5 py-6">
          {error ? (
            <p role="alert">{t(errorKey(error))}</p>
          ) : ready ? (
            children
          ) : (
            <p className="text-muted">{t("common.loading")}</p>
          )}
        </main>
      </div>
    </div>
  );
}

export function StatusText({ group, code }: { group: string; code: string }) {
  const t = useTranslations("status");
  const key = `${group}.${code}`;
  if (t.has(key)) {
    return <span>{t(key)}</span>;
  }
  return (
    <span dir="ltr" className="[unicode-bidi:isolate]">
      {code}
    </span>
  );
}

export function YesNo({ value }: { value: boolean }) {
  const t = useTranslations("common");
  return <span>{value ? t("yes") : t("no")}</span>;
}

export function ActiveState({
  isActive,
  deletedAt,
}: {
  isActive: boolean;
  deletedAt: string | null;
}) {
  const t = useTranslations("common");
  if (deletedAt) {
    return <span>{t("deleted")}</span>;
  }
  return <span>{isActive ? t("active") : t("inactive")}</span>;
}

export function Appointment({
  iso,
  timeZone,
}: {
  iso: string;
  timeZone: string;
}) {
  const locale = useLocale();
  const t = useTranslations("common");
  const parts = appointmentParts(locale, iso, timeZone);
  return (
    <span className="inline-flex flex-wrap items-baseline gap-2">
      <span>{parts.when}</span>
      <span className="text-sm text-muted">
        {t("timezone")}{" "}
        <span dir="ltr" className="[unicode-bidi:isolate]">
          {parts.timeZone}
        </span>
      </span>
    </span>
  );
}

export function Count({ value }: { value: number }) {
  const locale = useLocale();
  return <span>{formatNumber(locale, value)}</span>;
}

export function BackLink({ href }: { href: string }) {
  const t = useTranslations("common");
  return (
    <Link href={href} className="text-sm text-accent underline">
      {t("back")}
    </Link>
  );
}
