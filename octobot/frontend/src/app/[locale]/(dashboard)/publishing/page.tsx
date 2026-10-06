"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { ActiveState, Appointment, StatusText } from "@/components/chrome";
import {
  DataCell,
  DataRow,
  DataTable,
  PageState,
  Pager,
} from "@/components/feedback";
import { UserContent, UsernameValue } from "@/components/values";
import { Link } from "@/i18n/navigation";
import { useResource } from "@/lib/use-resource";
import type { Page, PublishingRow } from "@/lib/types";

export default function PublishingPage() {
  const t = useTranslations("publishing");
  const open = useTranslations("common");
  const [page, setPage] = useState(1);
  const { data, error, loading, reload } = useResource<Page<PublishingRow>>(
    `/publishing?page=${page}`,
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
              t("listName"),
              t("bot"),
              t("publishing"),
              t("schedule"),
              t("nextSlot"),
              open("open"),
            ]}
          >
            {data.items.map((row) => (
              <DataRow key={row.id}>
                <DataCell>
                  <UserContent value={row.listName} />
                </DataCell>
                <DataCell>
                  <UsernameValue username={row.botUsername} />
                  <ActiveState isActive={row.isActive} deletedAt={row.deletedAt} />
                </DataCell>
                <DataCell>
                  {row.publishingEnabled === null
                    ? open("none")
                    : row.publishingEnabled
                      ? t("on")
                      : t("off")}
                </DataCell>
                <DataCell>
                  {row.scheduleMode ? (
                    <StatusText group="scheduleMode" code={row.scheduleMode} />
                  ) : (
                    open("none")
                  )}
                  {row.timeZone ? (
                    <span dir="ltr" className="ms-2 [unicode-bidi:isolate]">
                      {row.timeZone}
                    </span>
                  ) : null}
                </DataCell>
                <DataCell>
                  {row.nextSlot && row.timeZone ? (
                    <Appointment
                      iso={row.nextSlot.scheduledAt}
                      timeZone={row.timeZone}
                    />
                  ) : (
                    open("none")
                  )}
                </DataCell>
                <DataCell>
                  <Link
                    href={`/publishing/${row.id}`}
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
