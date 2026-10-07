"use client";

import { useTranslations } from "next-intl";
import { ActiveState, Count, StatusText } from "@/components/chrome";
import { FilterSelect, RecordList, SearchField } from "@/components/blocks";
import { PageState, Pager } from "@/components/feedback";
import { Person } from "@/components/values";
import { Link } from "@/i18n/navigation";
import { useListFilters } from "@/lib/use-list";
import { useResource } from "@/lib/use-resource";
import type { BotRow, Page } from "@/lib/types";

export default function BotsPage() {
  const t = useTranslations("bots");
  const common = useTranslations("common");
  const filters = useTranslations("filters");
  const status = useTranslations("status.bot");
  const list = useListFilters();
  const { data, error, loading, reload } = useResource<Page<BotRow>>(
    `/bots?${list.query}`,
  );
  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted">{t("purpose")}</p>
      <div className="flex flex-col gap-3 md:flex-row">
        <SearchField label={filters("search")} value={list.q} onChange={list.setQ} />
        <FilterSelect
          label={filters("type")}
          value={list.type}
          onChange={list.setType}
          options={[
            { value: "", label: filters("all") },
            { value: "PLATFORM_BOT", label: status("PLATFORM_BOT") },
            { value: "CONTACT_BOT", label: status("CONTACT_BOT") },
            { value: "SUPPORT_LIST_BOT", label: status("SUPPORT_LIST_BOT") },
          ]}
        />
        <FilterSelect
          label={filters("status")}
          value={list.status}
          onChange={list.setStatus}
          options={[
            { value: "", label: filters("all") },
            { value: "active", label: common("active") },
            { value: "inactive", label: common("inactive") },
            { value: "deleted", label: common("deleted") },
          ]}
        />
      </div>
      <PageState
        loading={loading}
        error={error}
        empty={Boolean(data && data.items.length === 0)}
        emptyMessage={list.filtering ? common("emptyFiltered") : common("empty")}
        onRetry={() => void reload()}
      />
      {!loading && data && data.items.length > 0 ? (
        <>
          <RecordList
            rows={data.items}
            rowKey={(bot) => bot.id}
            columns={[
              {
                header: t("username"),
                render: (bot) => (
                  <Link
                    href={`/bots/${bot.id}`}
                    dir="ltr"
                    className="[unicode-bidi:isolate] font-medium text-action underline"
                  >
                    {bot.botUsername}
                  </Link>
                ),
              },
              {
                header: t("type"),
                render: (bot) => <StatusText group="bot" code={bot.botType} />,
              },
              {
                header: t("status"),
                render: (bot) => (
                  <ActiveState isActive={bot.isActive} deletedAt={bot.deletedAt} />
                ),
              },
              {
                header: t("owner"),
                render: (bot) => (
                  <Person
                    firstName={bot.owner.firstName}
                    username={bot.owner.username}
                    telegramId={bot.owner.telegramId}
                  />
                ),
              },
              {
                header: t("links"),
                render: (bot) => <Count value={bot.activeLinkCount} />,
              },
              {
                header: t("platformForced"),
                render: (bot) => (bot.allowPlatformForced ? t("allowed") : t("optedOut")),
              },
            ]}
          />
          <Pager page={data.page} pageCount={data.pageCount} onPage={list.setPage} />
        </>
      ) : null}
    </div>
  );
}
