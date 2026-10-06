"use client";

import { useTranslations } from "next-intl";
import { PageState } from "@/components/feedback";
import { Count } from "@/components/chrome";
import { useResource } from "@/lib/use-resource";
import type { Overview } from "@/lib/types";

export default function OverviewPage() {
  const t = useTranslations("overview");
  const { data, error, loading, reload } = useResource<Overview>("/overview");
  const state = (
    <PageState loading={loading} error={error} onRetry={() => void reload()} />
  );
  if (!data) {
    return state;
  }
  const cards = [
    ["users", data.users],
    ["bots", data.bots],
    ["channels", data.channels],
    ["activeCycles", data.activeCycles],
    ["catalogChannels", data.catalogChannels],
  ] as const;
  return (
    <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {cards.map(([key, value]) => (
        <article key={key} className="rounded-2xl border border-line bg-card p-5">
          <p className="text-sm text-muted">{t(key)}</p>
          <p className="mt-2 text-3xl font-semibold">
            <Count value={value} />
          </p>
        </article>
      ))}
    </section>
  );
}
