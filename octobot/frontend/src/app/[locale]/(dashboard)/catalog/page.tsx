"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Appointment, Count, StatusText } from "@/components/chrome";
import {
  Alert,
  DataCell,
  DataRow,
  DataTable,
  PageState,
} from "@/components/feedback";
import { Person, UserContent, UsernameValue } from "@/components/values";
import { ApiError, api } from "@/lib/api";
import { useResource } from "@/lib/use-resource";
import type { CatalogItem, ForcedSubscriptionRow } from "@/lib/types";

export default function CatalogPage() {
  const t = useTranslations("catalog");
  const common = useTranslations("common");
  const catalog = useResource<{ items: CatalogItem[] }>("/catalog");
  const subs = useResource<{ total: number; items: ForcedSubscriptionRow[] }>(
    "/forced-subscriptions",
  );
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  async function run(action: () => Promise<void>) {
    setError(null);
    setSaved(false);
    try {
      await action();
      setSaved(true);
      await catalog.reload();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.code : "generic");
    }
  }

  const items = catalog.data?.items ?? [];

  return (
    <div className="flex flex-col gap-6">
      <Alert code={saved ? "saved" : null} tone="saved" />
      <Alert code={error} />
      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">{t("catalog")}</h2>
        <PageState
          loading={catalog.loading}
          error={catalog.error}
          empty={Boolean(catalog.data && items.length === 0)}
          onRetry={() => void catalog.reload()}
        />
        {items.length > 0 ? (
          <DataTable
            headers={[t("sort"), t("channel"), common("active"), t("moveUp")]}
          >
            {items.map((item, index) => (
              <DataRow key={item.id}>
                <DataCell>
                  <Count value={item.sortOrder + 1} />
                </DataCell>
                <DataCell>
                  <UserContent value={item.channel.title} />
                  <UsernameValue username={item.channel.username} />
                </DataCell>
                <DataCell>{item.isActive ? common("active") : common("inactive")}</DataCell>
                <DataCell>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      disabled={index === 0}
                      className="rounded-full border border-line px-3 py-1 text-sm disabled:opacity-40"
                      onClick={() =>
                        void run(async () => {
                          const next = [...items];
                          const [row] = next.splice(index, 1);
                          if (!row) {
                            return;
                          }
                          next.splice(index - 1, 0, row);
                          await api("/catalog/order", {
                            method: "PUT",
                            body: JSON.stringify({ ids: next.map((entry) => entry.id) }),
                          });
                        })
                      }
                    >
                      {t("moveUp")}
                    </button>
                    <button
                      type="button"
                      disabled={index === items.length - 1}
                      className="rounded-full border border-line px-3 py-1 text-sm disabled:opacity-40"
                      onClick={() =>
                        void run(async () => {
                          const next = [...items];
                          const [row] = next.splice(index, 1);
                          if (!row) {
                            return;
                          }
                          next.splice(index + 1, 0, row);
                          await api("/catalog/order", {
                            method: "PUT",
                            body: JSON.stringify({ ids: next.map((entry) => entry.id) }),
                          });
                        })
                      }
                    >
                      {t("moveDown")}
                    </button>
                    <button
                      type="button"
                      className="rounded-full bg-ink px-3 py-1 text-sm text-card"
                      onClick={() =>
                        void run(() =>
                          api(`/catalog/${item.id}`, {
                            method: "PATCH",
                            body: JSON.stringify({ isActive: !item.isActive }),
                          }),
                        )
                      }
                    >
                      {item.isActive ? t("deactivate") : t("activate")}
                    </button>
                  </div>
                </DataCell>
              </DataRow>
            ))}
          </DataTable>
        ) : null}
      </section>
      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">
          {t("ownerSubs")}{" "}
          {subs.data ? <Count value={subs.data.total} /> : null}
        </h2>
        <PageState
          loading={subs.loading}
          error={subs.error}
          empty={Boolean(subs.data && subs.data.items.length === 0)}
          onRetry={() => void subs.reload()}
        />
        {subs.data && subs.data.items.length > 0 ? (
          <DataTable
            headers={[t("channel"), t("bot"), t("addedBy"), t("createdAt")]}
          >
            {subs.data.items.map((row) => (
              <DataRow key={row.id}>
                <DataCell>
                  <UserContent value={row.channel.title} />
                  <UsernameValue username={row.channel.username} />
                </DataCell>
                <DataCell>
                  <UsernameValue username={row.bot.botUsername} />
                  <StatusText group="bot" code={row.bot.botType} />
                </DataCell>
                <DataCell>
                  <Person
                    firstName={row.addedBy.firstName}
                    username={row.addedBy.username}
                    telegramId={row.addedBy.telegramId}
                  />
                </DataCell>
                <DataCell>
                  <Appointment iso={row.createdAt} timeZone="UTC" />
                </DataCell>
              </DataRow>
            ))}
          </DataTable>
        ) : null}
      </section>
    </div>
  );
}
