"use client";

import { useLocale, useTranslations } from "next-intl";
import { Count } from "@/components/chrome";
import { PageState } from "@/components/feedback";
import { Link } from "@/i18n/navigation";
import { formatNumber } from "@/lib/format";
import { useResource } from "@/lib/use-resource";
import type { Overview } from "@/lib/types";

const LINKS = [
  ["/bots", "bots"],
  ["/channels", "channels"],
  ["/publishing", "publishing"],
  ["/catalog", "catalog"],
] as const;

export default function OverviewPage() {
  const t = useTranslations("overview");
  const nav = useTranslations("nav");
  const locale = useLocale();
  const { data, error, loading, reload } = useResource<Overview>("/overview");
  if (!data) {
    return <PageState loading={loading} error={error} onRetry={() => void reload()} />;
  }
  const figures = [
    ["users", data.users],
    ["bots", data.bots],
    ["channels", data.channels],
    ["activeCycles", data.activeCycles],
    ["catalogChannels", data.catalogChannels],
  ] as const;
  return (
    <div className="flex flex-col gap-5">
      <p className="text-sm text-muted">{t("purpose")}</p>
      <ul className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-line bg-line md:grid-cols-5">
        {figures.map(([key, value]) => (
          <li key={key} className="bg-card px-3 py-3">
            <p className="text-xs text-muted">{t(key)}</p>
            <p className="mt-1 text-xl font-semibold">
              <Count value={value} />
            </p>
          </li>
        ))}
      </ul>
      <div className="flex flex-col gap-1 text-sm">
        <p>
          {data.activeCycles > 0
            ? t("cyclesActive", { count: formatNumber(locale, data.activeCycles) })
            : t("cyclesNone")}
        </p>
        <p>{t("catalogCount", { count: formatNumber(locale, data.catalogChannels) })}</p>
      </div>
      <nav aria-label={t("purpose")} className="flex flex-col border-t border-line">
        {LINKS.map(([href, key]) => (
          <Link
            key={href}
            href={href}
            className="border-b border-line py-3 text-sm font-medium text-action"
          >
            {nav(key)}
          </Link>
        ))}
      </nav>
    </div>
  );
}
