"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { ActiveState, Appointment } from "@/components/chrome";
import {
  DataCell,
  DataRow,
  DataTable,
  PageState,
  Pager,
} from "@/components/feedback";
import { Person } from "@/components/values";
import { useResource } from "@/lib/use-resource";
import type { Page, UserRow } from "@/lib/types";

export default function UsersPage() {
  const t = useTranslations("users");
  const [page, setPage] = useState(1);
  const { data, error, loading, reload } = useResource<Page<UserRow>>(
    `/users?page=${page}`,
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
            headers={[t("name"), t("createdAt"), t("status")]}
          >
            {data.items.map((user) => (
              <DataRow key={user.id}>
                <DataCell>
                  <Person
                    firstName={user.firstName}
                    lastName={user.lastName}
                    username={user.username}
                    telegramId={user.telegramId}
                  />
                </DataCell>
                <DataCell>
                  <Appointment iso={user.createdAt} timeZone="UTC" />
                </DataCell>
                <DataCell>
                  <ActiveState isActive={!user.deletedAt} deletedAt={user.deletedAt} />
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
