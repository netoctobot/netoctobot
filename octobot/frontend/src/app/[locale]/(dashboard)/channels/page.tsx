"use client";

import { useTranslations } from "next-intl";
import { ActiveState, Count, YesNo } from "@/components/chrome";
import { FilterSelect, RecordList, SearchField } from "@/components/blocks";
import { PageState, Pager } from "@/components/feedback";
import { Person, UserContent } from "@/components/values";
import { Link } from "@/i18n/navigation";
import { useListFilters } from "@/lib/use-list";
import { useResource } from "@/lib/use-resource";
import type { ChannelRow, Page } from "@/lib/types";

export default function ChannelsPage() {
  const t = useTranslations("channels");
  const common = useTranslations("common");
  const filters = useTranslations("filters");
  const list = useListFilters();
  const { data, error, loading, reload } = useResource<Page<ChannelRow>>(
    `/channels?${list.query}`,
  );
  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted">{t("purpose")}</p>
      <div className="flex flex-col gap-3 md:flex-row">
        <SearchField label={filters("search")} value={list.q} onChange={list.setQ} />
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
        <FilterSelect
          label={filters("catalog")}
          value={list.catalog}
          onChange={list.setCatalog}
          options={[
            { value: "", label: filters("all") },
            { value: "yes", label: filters("inCatalog") },
            { value: "no", label: filters("notInCatalog") },
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
            rowKey={(channel) => channel.id}
            columns={[
              {
                header: t("name"),
                render: (channel) => (
                  <Link
                    href={`/channels/${channel.id}`}
                    className="font-medium text-action underline"
                  >
                    <UserContent value={channel.title} />
                  </Link>
                ),
              },
              {
                header: t("username"),
                render: (channel) => (
                  <span dir="ltr" className="[unicode-bidi:isolate]">
                    {channel.username ?? common("none")}
                  </span>
                ),
              },
              {
                header: t("members"),
                render: (channel) => <Count value={channel.memberCount} />,
              },
              {
                header: t("catalog"),
                render: (channel) => <YesNo value={channel.isPlatformCatalog} />,
              },
              {
                header: t("status"),
                render: (channel) => (
                  <ActiveState isActive={channel.isActive} deletedAt={channel.deletedAt} />
                ),
              },
              {
                header: t("owner"),
                render: (channel) =>
                  channel.owner ? (
                    <Person
                      firstName={channel.owner.firstName}
                      username={channel.owner.username}
                      telegramId={channel.owner.telegramId}
                    />
                  ) : (
                    <UserContent value={null} />
                  ),
              },
            ]}
          />
          <Pager page={data.page} pageCount={data.pageCount} onPage={list.setPage} />
        </>
      ) : null}
    </div>
  );
}
