"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { ActiveState, Count, YesNo } from "@/components/chrome";
import {
  DataCell,
  DataRow,
  DataTable,
  PageState,
  Pager,
} from "@/components/feedback";
import { Person, UserContent, UsernameValue } from "@/components/values";
import { Link } from "@/i18n/navigation";
import { useResource } from "@/lib/use-resource";
import type { ChannelRow, Page } from "@/lib/types";

export default function ChannelsPage() {
  const t = useTranslations("channels");
  const open = useTranslations("common");
  const [page, setPage] = useState(1);
  const { data, error, loading, reload } = useResource<Page<ChannelRow>>(
    `/channels?page=${page}`,
  );
  return (
    <div className="flex flex-col gap-4">
      <PageState
        loading={loading}
        error={error}
        empty={Boolean(data && data.items.length === 0)}
        onRetry={() => void reload()}
      />
      {data && data.items.length > 0 ? (
        <>
          <DataTable
            headers={[
              t("name"),
              t("members"),
              t("catalog"),
              t("status"),
              t("owner"),
              open("open"),
            ]}
          >
            {data.items.map((channel) => (
              <DataRow key={channel.id}>
                <DataCell>
                  <UserContent value={channel.title} />
                  <UsernameValue username={channel.username} />
                </DataCell>
                <DataCell>
                  <Count value={channel.memberCount} />
                </DataCell>
                <DataCell>
                  <YesNo value={channel.isPlatformCatalog} />
                </DataCell>
                <DataCell>
                  <ActiveState
                    isActive={channel.isActive}
                    deletedAt={channel.deletedAt}
                  />
                </DataCell>
                <DataCell>
                  <Person
                    firstName={channel.owner.firstName}
                    username={channel.owner.username}
                    telegramId={channel.owner.telegramId}
                  />
                </DataCell>
                <DataCell>
                  <Link
                    href={`/channels/${channel.id}`}
                    className="text-accent underline"
                  >
                    {open("open")}
                  </Link>
                </DataCell>
              </DataRow>
            ))}
          </DataTable>
          <Pager page={data.page} pageCount={data.pageCount} onPage={setPage} />
        </>
      ) : null}
    </div>
  );
}
