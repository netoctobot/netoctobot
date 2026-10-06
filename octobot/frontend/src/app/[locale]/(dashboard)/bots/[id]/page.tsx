"use client";

import { useTranslations } from "next-intl";
import { useParams } from "next/navigation";
import {
  ActiveState,
  Appointment,
  BackLink,
  Count,
  StatusText,
} from "@/components/chrome";
import {
  DataCell,
  DataRow,
  DataTable,
  PageState,
} from "@/components/feedback";
import { CopyValue, Person, UserContent, UsernameValue } from "@/components/values";
import { useResource } from "@/lib/use-resource";
import type { BotDetail } from "@/lib/types";

function StoredTexts({
  title,
  texts,
}: {
  title: string;
  texts: Record<string, string>;
}) {
  const language = useTranslations("language");
  const none = useTranslations("common");
  const entries = Object.entries(texts);
  const labels: Record<string, string> = {
    ar: language("arabic"),
    en: language("english"),
  };
  return (
    <section className="flex flex-col gap-3 rounded-2xl border border-line bg-card p-5">
      <h2 className="font-semibold">{title}</h2>
      {entries.length === 0 ? <p className="text-muted">{none("none")}</p> : null}
      {entries.map(([key, value]) => (
        <div key={key} className="flex flex-col gap-1">
          <h3 className="text-sm text-muted">
            {labels[key] ?? (
              <span dir="ltr" className="[unicode-bidi:isolate]">
                {key}
              </span>
            )}
          </h3>
          <p>
            <UserContent value={value} />
          </p>
        </div>
      ))}
    </section>
  );
}

export default function BotDetailPage() {
  const params = useParams<{ id: string }>();
  const t = useTranslations("bots");
  const channels = useTranslations("channels");
  const copy = useTranslations("copy");
  const publishing = useTranslations("publishing");
  const { data, error, loading, reload } = useResource<BotDetail>(
    `/bots/${params.id}`,
  );
  if (!data) {
    return (
      <PageState loading={loading} error={error} onRetry={() => void reload()} />
    );
  }
  return (
    <div className="flex flex-col gap-5">
      <BackLink href="/bots" />
      <section className="flex flex-col gap-3 rounded-2xl border border-line bg-card p-5">
        <UsernameValue username={data.botUsername} />
        <p>
          <StatusText group="bot" code={data.botType} />
        </p>
        <p>
          <ActiveState isActive={data.isActive} deletedAt={data.deletedAt} />
        </p>
        <p>
          {t("platformForced")}: {data.allowPlatformForced ? t("allowed") : t("optedOut")}
        </p>
        <p>
          {t("createdAt")}: <Appointment iso={data.createdAt} timeZone="UTC" />
        </p>
        <Person
          firstName={data.owner.firstName}
          username={data.owner.username}
          telegramId={data.owner.telegramId}
        />
        <CopyValue value={data.id} label={copy("id")} />
      </section>
      <StoredTexts title={t("welcome")} texts={data.welcomeMessages} />
      <StoredTexts title={t("footer")} texts={data.footerTexts} />
      {data.supportList ? (
        <section className="flex flex-col gap-2 rounded-2xl border border-line bg-card p-5">
          <h2 className="font-semibold">
            <UserContent value={data.supportList.listName} />
          </h2>
          <p>
            {publishing("schedule")}:{" "}
            <span dir="ltr" className="[unicode-bidi:isolate]">
              {data.supportList.timeZone}
            </span>
          </p>
          <p>
            {publishing("retention")}:{" "}
            <Count value={data.supportList.retentionMinutes} />
          </p>
        </section>
      ) : null}
      <DataTable
        headers={[channels("name"), channels("status"), channels("reason")]}
      >
        {data.links.map((link) => (
          <DataRow key={link.id}>
            <DataCell>
              <UserContent value={link.channel.title} />
              <UsernameValue username={link.channel.username} />
              <CopyValue value={link.channel.telegramId} label={copy("id")} />
            </DataCell>
            <DataCell>
              <StatusText group="link" code={link.status} />
            </DataCell>
            <DataCell>
              <UserContent value={link.deactivationReason} />
            </DataCell>
          </DataRow>
        ))}
      </DataTable>
    </div>
  );
}
