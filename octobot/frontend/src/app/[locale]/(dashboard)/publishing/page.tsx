"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { ActiveState, Appointment, StatusText } from "@/components/chrome";
import { RecordList } from "@/components/blocks";
import { PageState, Pager } from "@/components/feedback";
import { UserContent } from "@/components/values";
import { Link } from "@/i18n/navigation";
import { useResource } from "@/lib/use-resource";
import type { Page, PublishingRow } from "@/lib/types";

export default function PublishingPage() {
  const t = useTranslations("publishing");
  const common = useTranslations("common");
  const [page, setPage] = useState(1);
  const { data, error, loading, reload } = useResource<Page<PublishingRow>>(
    `/publishing?page=${page}`,
  );
  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted">{t("purpose")}</p>
      <PageState
        loading={loading}
        error={error}
        empty={Boolean(data && data.items.length === 0)}
        onRetry={() => void reload()}
      />
      {!loading && data && data.items.length > 0 ? (
        <>
          <RecordList
            rows={data.items}
            rowKey={(row) => row.id}
            columns={[
              {
                header: t("listName"),
                render: (row) => (
                  <Link href={`/publishing/${row.id}`} className="font-medium text-action underline">
                    <UserContent value={row.listName} />
                  </Link>
                ),
              },
              {
                header: t("bot"),
                render: (row) => (
                  <span className="flex flex-col items-start gap-1">
                    <span dir="ltr" className="[unicode-bidi:isolate]">
                      {row.botUsername}
                    </span>
                    <ActiveState isActive={row.isActive} deletedAt={row.deletedAt} />
                  </span>
                ),
              },
              {
                header: t("publishing"),
                render: (row) =>
                  row.publishingEnabled === null
                    ? common("none")
                    : row.publishingEnabled
                      ? t("on")
                      : t("off"),
              },
              {
                header: t("schedule"),
                render: (row) => (
                  <span className="flex flex-col items-start gap-1">
                    {row.scheduleMode ? (
                      <StatusText group="scheduleMode" code={row.scheduleMode} />
                    ) : (
                      common("none")
                    )}
                    {row.timeZone ? (
                      <span dir="ltr" className="[unicode-bidi:isolate]">
                        {row.timeZone}
                      </span>
                    ) : null}
                  </span>
                ),
              },
              {
                header: t("nextSlot"),
                render: (row) =>
                  row.nextSlot && row.timeZone ? (
                    <Appointment iso={row.nextSlot.scheduledAt} timeZone={row.timeZone} />
                  ) : (
                    common("none")
                  ),
              },
            ]}
          />
          <Pager page={data.page} pageCount={data.pageCount} onPage={setPage} />
        </>
      ) : null}
    </div>
  );
}
