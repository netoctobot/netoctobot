"use client";

import { useTranslations } from "next-intl";
import { useParams } from "next/navigation";
import {
  ActiveState,
  Appointment,
  BackLink,
  Count,
  StatusText,
  YesNo,
} from "@/components/chrome";
import {
  DataCell,
  DataRow,
  DataTable,
  PageState,
} from "@/components/feedback";
import { CopyValue, Person, UserContent, UsernameValue } from "@/components/values";
import { useResource } from "@/lib/use-resource";
import type { ChannelDetail } from "@/lib/types";

export default function ChannelDetailPage() {
  const params = useParams<{ id: string }>();
  const t = useTranslations("channels");
  const copy = useTranslations("copy");
  const { data, error, loading, reload } = useResource<ChannelDetail>(
    `/channels/${params.id}`,
  );
  if (!data) {
    return (
      <PageState loading={loading} error={error} onRetry={() => void reload()} />
    );
  }
  return (
    <div className="flex flex-col gap-5">
      <BackLink href="/channels" />
      <section className="flex flex-col gap-2 rounded-2xl border border-line bg-card p-5">
        <h2 className="text-xl font-semibold">
          <UserContent value={data.title} />
        </h2>
        <UsernameValue username={data.username} />
        <CopyValue value={data.telegramId} label={copy("id")} />
        <p>
          {t("members")}: <Count value={data.memberCount} />
        </p>
        <p>
          {t("catalog")}: <YesNo value={data.isPlatformCatalog} />
        </p>
        <p>
          <ActiveState isActive={data.isActive} deletedAt={data.deletedAt} />
        </p>
        <p>
          {t("addedAt")}: <Appointment iso={data.addedAt} timeZone="UTC" />
        </p>
        <p>
          {t("reason")}: <UserContent value={data.deactivationReason} />
        </p>
        <Person
          firstName={data.owner.firstName}
          username={data.owner.username}
          telegramId={data.owner.telegramId}
        />
      </section>
      <DataTable headers={[t("links"), t("status"), t("reason")]}>
        {data.links.map((link) => (
          <DataRow key={link.id}>
            <DataCell>
              <UsernameValue username={link.bot.botUsername} />
              <StatusText group="bot" code={link.bot.botType} />
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
