"use client";

import { useTranslations } from "next-intl";
import { useParams } from "next/navigation";
import { Fields, RecordList, Section } from "@/components/blocks";
import {
  ActiveState,
  Appointment,
  BackLink,
  Count,
  StatusText,
  YesNo,
} from "@/components/chrome";
import { PageState } from "@/components/feedback";
import { CopyValue, Person, UserContent, UsernameValue } from "@/components/values";
import { Link } from "@/i18n/navigation";
import { useResource } from "@/lib/use-resource";
import type { ChannelDetail } from "@/lib/types";

export default function ChannelDetailPage() {
  const params = useParams<{ id: string }>();
  const t = useTranslations("channels");
  const copy = useTranslations("copy");
  const common = useTranslations("common");
  const { data, error, loading, reload } = useResource<ChannelDetail>(
    `/channels/${params.id}`,
  );
  if (!data) {
    return <PageState loading={loading} error={error} onRetry={() => void reload()} />;
  }
  return (
    <div>
      <BackLink href="/channels" />
      <Section title={t("name")} hint={t("recordHint")}>
        <Fields
          items={[
            { label: t("name"), value: <UserContent value={data.title} /> },
            { label: t("username"), value: <UsernameValue username={data.username} /> },
            {
              label: t("telegramId"),
              value: <CopyValue value={data.telegramId} label={copy("id")} />,
            },
            { label: t("members"), value: <Count value={data.memberCount} /> },
            { label: t("catalog"), value: <YesNo value={data.isPlatformCatalog} /> },
            {
              label: t("status"),
              value: <ActiveState isActive={data.isActive} deletedAt={data.deletedAt} />,
            },
            {
              label: t("addedAt"),
              value: <Appointment iso={data.addedAt} timeZone="UTC" />,
            },
            { label: t("reason"), value: <UserContent value={data.deactivationReason} /> },
          ]}
        />
        <Person
          firstName={data.owner.firstName}
          username={data.owner.username}
          telegramId={data.owner.telegramId}
        />
      </Section>
      <Section title={t("links")} hint={t("linksHint")}>
        {data.links.length === 0 ? (
          <p className="text-sm text-muted">{common("empty")}</p>
        ) : (
          <RecordList
            rows={data.links}
            rowKey={(link) => link.id}
            columns={[
              {
                header: t("links"),
                render: (link) => (
                  <Link
                    href={`/bots/${link.bot.id}`}
                    dir="ltr"
                    className="[unicode-bidi:isolate] text-action underline"
                  >
                    {link.bot.botUsername}
                  </Link>
                ),
              },
              {
                header: t("status"),
                render: (link) => (
                  <span className="flex flex-col items-start gap-1">
                    <StatusText group="bot" code={link.bot.botType} />
                    <StatusText group="link" code={link.status} />
                  </span>
                ),
              },
              {
                header: t("reason"),
                render: (link) => <UserContent value={link.deactivationReason} />,
              },
            ]}
          />
        )}
      </Section>
    </div>
  );
}
