"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { ActiveState, Count, StatusText } from "@/components/chrome";
import {
  DataCell,
  DataRow,
  DataTable,
  PageState,
  Pager,
} from "@/components/feedback";
import { Person, UsernameValue } from "@/components/values";
import { Link } from "@/i18n/navigation";
import { useResource } from "@/lib/use-resource";
import type { BotRow, Page } from "@/lib/types";

export default function BotsPage() {
  const t = useTranslations("bots");
  const open = useTranslations("common");
  const [page, setPage] = useState(1);
  const { data, error, loading, reload } = useResource<Page<BotRow>>(
    `/bots?page=${page}`,
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
              t("username"),
              t("type"),
              t("status"),
              t("owner"),
              t("links"),
              t("platformForced"),
              open("open"),
            ]}
          >
            {data.items.map((bot) => (
              <DataRow key={bot.id}>
                <DataCell>
                  <UsernameValue username={bot.botUsername} />
                </DataCell>
                <DataCell>
                  <StatusText group="bot" code={bot.botType} />
                </DataCell>
                <DataCell>
                  <ActiveState isActive={bot.isActive} deletedAt={bot.deletedAt} />
                </DataCell>
                <DataCell>
                  <Person
                    firstName={bot.owner.firstName}
                    username={bot.owner.username}
                    telegramId={bot.owner.telegramId}
                  />
                </DataCell>
                <DataCell>
                  <Count value={bot.activeLinkCount} />
                </DataCell>
                <DataCell>{bot.allowPlatformForced ? t("allowed") : t("optedOut")}</DataCell>
                <DataCell>
                  <Link href={`/bots/${bot.id}`} className="text-accent underline">
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
