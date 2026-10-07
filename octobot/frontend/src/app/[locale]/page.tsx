"use client";

import { useLocale, useTranslations } from "next-intl";
import { type FormEvent, useEffect, useState } from "react";
import { LocaleSwitcher } from "@/components/chrome";
import { Alert } from "@/components/feedback";
import { useRouter } from "@/i18n/navigation";
import { ApiError, api } from "@/lib/api";
import type { LoginResult } from "@/lib/types";

export default function LoginPage() {
  const t = useTranslations("login");
  const locale = useLocale();
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  function openDashboard(result: LoginResult) {
    const account =
      result.webLocale === "AR" ? "ar" : result.webLocale === "EN" ? "en" : null;
    if (!account) {
      router.replace("/overview");
      return;
    }
    router.replace("/overview", { locale: account });
  }

  useEffect(() => {
    let cancelled = false;
    api<LoginResult>("/me")
      .then((result) => {
        if (!cancelled) {
          const account =
            result.webLocale === "AR" ? "ar" : result.webLocale === "EN" ? "en" : null;
          if (!account) {
            router.replace("/overview");
            return;
          }
          router.replace("/overview", { locale: account });
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [router]);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      const result = await api<LoginResult>("/session", {
        method: "POST",
        body: JSON.stringify({ username, password }),
      });
      if (!result.webLocale) {
        await api("/locale", {
          method: "PUT",
          body: JSON.stringify({ language: locale === "ar" ? "AR" : "EN" }),
        });
      }
      openDashboard(result);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.code : "generic");
    } finally {
      setPending(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col justify-center gap-6 px-6 py-12">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <p className="text-sm text-muted">{t("title")}</p>
        <LocaleSwitcher signedIn={false} />
      </header>
      <section className="flex flex-col gap-4 rounded-3xl border border-line bg-card p-6">
        <h1 className="text-3xl font-semibold">{t("title")}</h1>
        <p className="text-muted">{t("intro")}</p>
        <form className="flex flex-col gap-4" onSubmit={(event) => void onSubmit(event)}>
          <label className="flex flex-col gap-1 text-sm">
            {t("username")}
            <input
              name="username"
              autoComplete="username"
              dir="ltr"
              required
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              className="rounded-xl border border-line bg-paper px-3 py-2 text-base text-ink"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            {t("password")}
            <input
              name="password"
              type="password"
              autoComplete="current-password"
              dir="ltr"
              required
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className="rounded-xl border border-line bg-paper px-3 py-2 text-base text-ink"
            />
          </label>
          <Alert code={error} />
          <button
            type="submit"
            disabled={pending}
            className="rounded-full bg-accent px-4 py-2 text-sm text-card disabled:opacity-40"
          >
            {t("submit")}
          </button>
        </form>
      </section>
    </main>
  );
}
