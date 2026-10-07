"use client";

import {
  Bot,
  LayoutDashboard,
  Menu,
  Megaphone,
  Radio,
  ScrollText,
  ShieldCheck,
  Users,
  X,
  type LucideIcon,
} from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { ApiError, api, errorKey } from "@/lib/api";
import { appointmentParts, formatNumber } from "@/lib/format";
import { Link, usePathname, useRouter } from "@/i18n/navigation";
import type { Me } from "@/lib/types";
import type { ReactNode } from "react";
import { useEffect, useState } from "react";

const NAV = [
  ["/overview", "overview", LayoutDashboard],
  ["/users", "users", Users],
  ["/bots", "bots", Bot],
  ["/channels", "channels", Radio],
  ["/publishing", "publishing", Megaphone],
  ["/catalog", "catalog", ShieldCheck],
  ["/audit", "audit", ScrollText],
] as const satisfies ReadonlyArray<readonly [string, string, LucideIcon]>;

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
        className="inline-flex rounded-lg border border-line bg-card p-0.5"
      >
        {(["ar", "en"] as const).map((choice) => (
          <button
            key={choice}
            type="button"
            aria-pressed={locale === choice}
            onClick={() => void select(choice)}
            className={`rounded-md px-2.5 py-1 text-sm ${
              locale === choice ? "bg-action text-white" : "text-ink"
            }`}
          >
            {choice === "ar" ? t("arabic") : t("english")}
          </button>
        ))}
      </div>
      {error ? (
        <p role="alert" className="text-xs text-danger">
          {errors(errorKey(error))}
        </p>
      ) : null}
    </div>
  );
}

export function DashboardShell({ children }: { children: ReactNode }) {
  const t = useTranslations();
  const nav = useTranslations("nav");
  const shell = useTranslations("shell");
  const locale = useLocale();
  const pathname = usePathname();
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [adminName, setAdminName] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [narrow, setNarrow] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api<Me>("/me")
      .then((me) => {
        if (cancelled) {
          return;
        }
        setAdminName(me.admin.username);
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

  useEffect(() => {
    setMenuOpen(false);
  }, [pathname]);

  useEffect(() => {
    const media = window.matchMedia("(max-width: 767px)");
    const apply = () => setNarrow(media.matches);
    apply();
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, []);

  useEffect(() => {
    if (!menuOpen) {
      return;
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setMenuOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [menuOpen]);

  async function signOut() {
    await api("/session", { method: "DELETE" });
    router.replace("/");
  }

  const titleKey = NAV.find(
    ([href]) => pathname === href || pathname.startsWith(`${href}/`),
  )?.[1];

  return (
    <div className="min-h-screen bg-paper">
      {menuOpen ? (
        <button
          type="button"
          className="fixed inset-0 z-30 bg-ink/40 md:hidden"
          aria-label={shell("closeMenu")}
          onClick={() => setMenuOpen(false)}
        />
      ) : null}
      <aside
        id="admin-nav"
        aria-hidden={narrow && !menuOpen}
        {...(narrow && !menuOpen ? { inert: true } : {})}
        className={`fixed inset-y-0 start-0 z-40 flex w-60 flex-col gap-6 bg-sidebar px-3 py-4 text-card ${
          menuOpen ? "" : "drawer-off"
        }`}
      >
        <div className="flex items-center gap-2 px-2">
          <img
            src="/brand/mark.png"
            alt=""
            width={36}
            height={36}
            className="h-9 w-9 rounded-full"
          />
          <p className="text-sm font-semibold">{t("brand")}</p>
        </div>
        <nav aria-label={t("meta.title")} className="flex flex-col gap-1">
          {NAV.map(([href, key, Icon]) => {
            const active = pathname === href || pathname.startsWith(`${href}/`);
            return (
              <Link
                key={href}
                href={href}
                aria-current={active ? "page" : undefined}
                className={`flex items-center gap-2 rounded-lg px-2.5 py-2 text-sm ${
                  active ? "bg-accent text-white" : "text-card/90"
                }`}
              >
                <Icon aria-hidden="true" size={16} />
                {nav(key)}
              </Link>
            );
          })}
        </nav>
      </aside>
      <div className="md:ps-60">
        <header className="flex flex-wrap items-center gap-3 border-b border-line bg-card px-4 py-3">
          <button
            type="button"
            className="rounded-lg border border-line p-2 md:hidden"
            aria-expanded={menuOpen}
            aria-controls="admin-nav"
            onClick={() => setMenuOpen((open) => !open)}
          >
            {menuOpen ? <X aria-hidden="true" size={18} /> : <Menu aria-hidden="true" size={18} />}
            <span className="sr-only">{menuOpen ? shell("closeMenu") : shell("openMenu")}</span>
          </button>
          <h1 className="min-w-0 flex-1 text-lg font-semibold">
            {titleKey ? nav(titleKey) : t("meta.title")}
          </h1>
          <LocaleSwitcher signedIn />
          <div className="flex items-center gap-2">
            <p className="text-sm">
              <span className="text-muted">{shell("account")}</span>{" "}
              <span dir="ltr" className="[unicode-bidi:isolate] font-medium">
                {adminName ?? t("common.loading")}
              </span>
            </p>
            <button
              type="button"
              onClick={() => void signOut()}
              className="rounded-lg border border-line px-3 py-1.5 text-sm"
            >
              {nav("signOut")}
            </button>
          </div>
        </header>
        <main className="mx-auto flex w-full max-w-6xl flex-col gap-4 px-4 py-5">
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

export function StatusBadge({
  tone,
  children,
}: {
  tone: "active" | "inactive" | "deleted" | "neutral";
  children: ReactNode;
}) {
  const toneClass = {
    active: "bg-[#e5f3f2] text-action",
    inactive: "bg-[#f6efe2] text-warn",
    deleted: "bg-[#f8e8e8] text-danger",
    neutral: "bg-paper text-muted",
  }[tone];
  return (
    <span className={`inline-flex rounded px-2 py-0.5 text-xs font-medium ${toneClass}`}>
      {children}
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
    return <StatusBadge tone="deleted">{t("deleted")}</StatusBadge>;
  }
  return (
    <StatusBadge tone={isActive ? "active" : "inactive"}>
      {isActive ? t("active") : t("inactive")}
    </StatusBadge>
  );
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
    <Link href={href} className="text-sm text-action underline">
      {t("back")}
    </Link>
  );
}
