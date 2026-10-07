"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { RecordList, Section } from "@/components/blocks";
import { Appointment, Count, StatusBadge, StatusText } from "@/components/chrome";
import { Alert, Dialog, PageState } from "@/components/feedback";
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
  const [pending, setPending] = useState<CatalogItem | null>(null);

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

  async function move(index: number, direction: -1 | 1) {
    const next = [...items];
    const [row] = next.splice(index, 1);
    if (!row) {
      return;
    }
    next.splice(index + direction, 0, row);
    await api("/catalog/order", {
      method: "PUT",
      body: JSON.stringify({ ids: next.map((entry) => entry.id) }),
    });
  }

  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm text-muted">{t("purpose")}</p>
      <Alert code={saved ? "saved" : null} tone="saved" />
      <Alert code={error} />
      <Section title={t("catalog")} hint={t("catalogHint")}>
        <PageState
          loading={catalog.loading}
          error={catalog.error}
          empty={Boolean(catalog.data && items.length === 0)}
          onRetry={() => void catalog.reload()}
        />
        {!catalog.loading && items.length > 0 ? (
          <RecordList
            rows={items}
            rowKey={(item) => item.id}
            columns={[
              { header: t("sort"), render: (item) => <Count value={item.sortOrder + 1} /> },
              {
                header: t("channel"),
                render: (item) => (
                  <span className="flex flex-col items-start">
                    <UserContent value={item.channel.title} />
                    <UsernameValue username={item.channel.username} />
                  </span>
                ),
              },
              {
                header: common("active"),
                render: (item) => (
                  <StatusBadge tone={item.isActive ? "active" : "inactive"}>
                    {item.isActive ? common("active") : common("inactive")}
                  </StatusBadge>
                ),
              },
              {
                header: t("moveUp"),
                render: (item) => {
                  const index = items.findIndex((entry) => entry.id === item.id);
                  return (
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        disabled={index === 0}
                        className="rounded-lg border border-line px-2 py-1 text-sm disabled:opacity-40"
                        onClick={() => void run(() => move(index, -1))}
                      >
                        {t("moveUp")}
                      </button>
                      <button
                        type="button"
                        disabled={index === items.length - 1}
                        className="rounded-lg border border-line px-2 py-1 text-sm disabled:opacity-40"
                        onClick={() => void run(() => move(index, 1))}
                      >
                        {t("moveDown")}
                      </button>
                      <button
                        type="button"
                        className="rounded-lg bg-action px-2 py-1 text-sm text-white"
                        onClick={() => setPending(item)}
                      >
                        {item.isActive ? t("deactivate") : t("activate")}
                      </button>
                    </div>
                  );
                },
              },
            ]}
          />
        ) : null}
      </Section>
      <Section title={t("ownerSubs")} hint={t("subsHint")}>
        <PageState
          loading={subs.loading}
          error={subs.error}
          empty={Boolean(subs.data && subs.data.items.length === 0)}
          onRetry={() => void subs.reload()}
        />
        {subs.data && subs.data.total > 0 ? (
          <p className="text-sm text-muted">
            <Count value={subs.data.total} />
          </p>
        ) : null}
        {!subs.loading && subs.data && subs.data.items.length > 0 ? (
          <RecordList
            rows={subs.data.items}
            rowKey={(row) => row.id}
            columns={[
              {
                header: t("channel"),
                render: (row) => (
                  <span className="flex flex-col items-start">
                    <UserContent value={row.channel.title} />
                    <UsernameValue username={row.channel.username} />
                  </span>
                ),
              },
              {
                header: t("bot"),
                render: (row) => (
                  <span className="flex flex-col items-start">
                    <UsernameValue username={row.bot.botUsername} />
                    <StatusText group="bot" code={row.bot.botType} />
                  </span>
                ),
              },
              {
                header: t("addedBy"),
                render: (row) => (
                  <Person
                    firstName={row.addedBy.firstName}
                    username={row.addedBy.username}
                    telegramId={row.addedBy.telegramId}
                  />
                ),
              },
              {
                header: t("createdAt"),
                render: (row) => <Appointment iso={row.createdAt} timeZone="UTC" />,
              },
            ]}
          />
        ) : null}
      </Section>
      <Dialog
        open={pending !== null}
        title={pending?.isActive ? t("deactivate") : t("activate")}
        onClose={() => setPending(null)}
      >
        <p className="text-sm">
          {pending?.isActive ? t("confirmDeactivate") : t("confirmActivate")}
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            className="rounded-lg bg-action px-3 py-1.5 text-sm text-white"
            onClick={() => {
              const item = pending;
              if (!item) {
                return;
              }
              setPending(null);
              void run(() =>
                api(`/catalog/${item.id}`, {
                  method: "PATCH",
                  body: JSON.stringify({ isActive: !item.isActive }),
                }),
              );
            }}
          >
            {common("confirm")}
          </button>
          <button
            type="button"
            className="rounded-lg border border-line px-3 py-1.5 text-sm"
            onClick={() => setPending(null)}
          >
            {common("cancel")}
          </button>
        </div>
      </Dialog>
    </div>
  );
}
