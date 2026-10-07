"use client";

import { useTranslations } from "next-intl";
import { ActiveState, Appointment } from "@/components/chrome";
import { FilterSelect, RecordList, SearchField } from "@/components/blocks";
import { PageState, Pager } from "@/components/feedback";
import { Person } from "@/components/values";
import { useListFilters } from "@/lib/use-list";
import { useResource } from "@/lib/use-resource";
import type { Page, UserRow } from "@/lib/types";

export default function UsersPage() {
  const t = useTranslations("users");
  const common = useTranslations("common");
  const filters = useTranslations("filters");
  const list = useListFilters();
  const { data, error, loading, reload } = useResource<Page<UserRow>>(
    `/users?${list.query}`,
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
            rowKey={(user) => user.id}
            columns={[
              {
                header: t("name"),
                render: (user) => (
                  <Person
                    firstName={user.firstName}
                    lastName={user.lastName}
                    username={user.username}
                    telegramId={user.telegramId}
                  />
                ),
              },
              {
                header: t("createdAt"),
                render: (user) => <Appointment iso={user.createdAt} timeZone="UTC" />,
              },
              {
                header: t("status"),
                render: (user) => (
                  <ActiveState isActive={!user.deletedAt} deletedAt={user.deletedAt} />
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
