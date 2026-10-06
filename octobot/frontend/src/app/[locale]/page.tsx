"use client";

import { useLocale, useTranslations } from "next-intl";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState } from "react";
import { LocaleSwitcher } from "@/components/chrome";
import { Alert } from "@/components/feedback";
import { useRouter } from "@/i18n/navigation";
import { ApiError, api } from "@/lib/api";
import type { LoginResult } from "@/lib/types";

function LoginForm() {
  const t = useTranslations("login");
  const locale = useLocale();
  const router = useRouter();
  const params = useSearchParams();
  const started = useRef(false);
  const [botUsername, setBotUsername] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [widgetError, setWidgetError] = useState(false);
  const widget = useRef<HTMLDivElement>(null);

  async function finish(result: LoginResult) {
    const account =
      result.webLocale === "AR" ? "ar" : result.webLocale === "EN" ? "en" : null;
    if (!account) {
      await api("/locale", {
        method: "PUT",
        body: JSON.stringify({ language: locale === "ar" ? "AR" : "EN" }),
      });
      router.replace("/overview");
      return;
    }
    router.replace("/overview", { locale: account });
  }

  async function submit(payload: Record<string, unknown>) {
    setError(null);
    try {
      const result = await api<LoginResult>("/session", {
        method: "POST",
        body: JSON.stringify(payload),
      });
      await finish(result);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.code : "generic");
    }
  }

  useEffect(() => {
    const id = params.get("id");
    const hash = params.get("hash");
    const authDate = params.get("auth_date");
    const firstName = params.get("first_name");
    if (!id || !hash || !authDate || !firstName || started.current) {
      return;
    }
    started.current = true;
    void submit({
      id,
      hash,
      auth_date: authDate,
      first_name: firstName,
      last_name: params.get("last_name") ?? undefined,
      username: params.get("username") ?? undefined,
      photo_url: params.get("photo_url") ?? undefined,
    });
  }, [params]);

  useEffect(() => {
    let cancelled = false;
    api<{ botUsername: string }>("/login-info")
      .then((info) => {
        if (!cancelled) {
          setBotUsername(info.botUsername);
        }
      })
      .catch((caught: unknown) => {
        if (!cancelled) {
          setError(caught instanceof ApiError ? caught.code : "generic");
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const host = widget.current;
    if (!botUsername || !host) {
      return;
    }
    window.OctobotAdminTelegramAuth = (user) => {
      void submit(user);
    };
    const script = document.createElement("script");
    script.async = true;
    script.src = "https://telegram.org/js/telegram-widget.js?22";
    script.setAttribute("data-telegram-login", botUsername);
    script.setAttribute("data-size", "large");
    script.setAttribute("data-userpic", "false");
    script.setAttribute("data-onauth", "OctobotAdminTelegramAuth(user)");
    script.onerror = () => setWidgetError(true);
    host.replaceChildren(script);
    return () => {
      delete window.OctobotAdminTelegramAuth;
    };
  }, [botUsername]);

  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col justify-center gap-6 px-6 py-12">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <p className="text-sm text-muted">{t("title")}</p>
        <LocaleSwitcher signedIn={false} />
      </header>
      <section className="flex flex-col gap-4 rounded-3xl border border-line bg-card p-6">
        <h1 className="text-3xl font-semibold">{t("title")}</h1>
        <p className="text-muted">{t("intro")}</p>
        <Alert code={error} />
        <div dir="ltr" className="[unicode-bidi:isolate]" aria-label={t("widgetLabel")}>
          <div ref={widget} />
        </div>
        {widgetError ? <p role="alert">{t("widgetUnavailable")}</p> : null}
      </section>
    </main>
  );
}

export default function LoginPage() {
  const t = useTranslations("common");
  return (
    <Suspense fallback={<p className="p-6 text-muted">{t("loading")}</p>}>
      <LoginForm />
    </Suspense>
  );
}

declare global {
  interface Window {
    OctobotAdminTelegramAuth?: (user: Record<string, unknown>) => void;
  }
}
