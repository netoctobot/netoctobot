"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Appointment, YesNo } from "@/components/chrome";
import {
  DataCell,
  DataRow,
  DataTable,
  PageState,
  Pager,
} from "@/components/feedback";
import { CopyValue, Person, UserContent } from "@/components/values";
import { useResource } from "@/lib/use-resource";
import type { AuditRow, Page } from "@/lib/types";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function AuditDetails({ details }: { details: unknown }) {
  const t = useTranslations("audit");
  const publishing = useTranslations("publishing");
  const language = useTranslations("language");
  if (!isRecord(details)) {
    return <UserContent value={null} />;
  }
  return (
    <dl className="flex flex-col gap-1">
      {details.language === "AR" || details.language === "EN" ? (
        <div>
          <dt className="text-muted">{t("language")}</dt>
          <dd>{details.language === "AR" ? language("arabic") : language("english")}</dd>
        </div>
      ) : null}
      {typeof details.isActive === "boolean" ? (
        <div>
          <dt className="text-muted">{t("active")}</dt>
          <dd>
            <YesNo value={details.isActive} />
          </dd>
        </div>
      ) : null}
      {typeof details.reason === "string" ? (
        <div>
          <dt className="text-muted">{publishing("reason")}</dt>
          <dd>
            <UserContent value={details.reason} />
          </dd>
        </div>
      ) : null}
    </dl>
  );
}

export default function AuditPage() {
  const t = useTranslations("audit");
  const copy = useTranslations("copy");
  const [page, setPage] = useState(1);
  const { data, error, loading, reload } = useResource<Page<AuditRow>>(
    `/audit?page=${page}`,
  );
  const actions = useTranslations("audit.actions");
  const actionKey: Record<string, "webLocaleSet" | "supportListAdminDisable" | "catalogSetActive" | "catalogReorder"> = {
    "web_locale.set": "webLocaleSet",
    "support_list.admin_disable": "supportListAdminDisable",
    "catalog.set_active": "catalogSetActive",
    "catalog.reorder": "catalogReorder",
  };
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
            headers={[t("when"), t("action"), t("actor"), t("entity"), t("details")]}
          >
            {data.items.map((row) => (
              <DataRow key={row.id}>
                <DataCell>
                  <Appointment iso={row.createdAt} timeZone="UTC" />
                </DataCell>
                <DataCell>
                  {actionKey[row.action] ? (
                    actions(actionKey[row.action])
                  ) : (
                    <span dir="ltr" className="[unicode-bidi:isolate]">
                      {row.action}
                    </span>
                  )}
                </DataCell>
                <DataCell>
                  {row.actor ? (
                    <Person
                      firstName={row.actor.firstName}
                      username={row.actor.username}
                      telegramId={row.actor.telegramId}
                    />
                  ) : (
                    <UserContent value={null} />
                  )}
                </DataCell>
                <DataCell>
                  {row.entityId ? (
                    <CopyValue value={row.entityId} label={copy("id")} />
                  ) : (
                    <UserContent value={null} />
                  )}
                </DataCell>
                <DataCell>
                  <AuditDetails details={row.details} />
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
