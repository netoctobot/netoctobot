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
} from "@/components/chrome";
import { PageState } from "@/components/feedback";
import { CopyValue, Person, UserContent, UsernameValue } from "@/components/values";
import { Link } from "@/i18n/navigation";
import { useResource } from "@/lib/use-resource";
import type { BotDetail } from "@/lib/types";

export default function BotDetailPage() {
  const params = useParams<{ id: string }>();
  const t = useTranslations("bots");
  const channels = useTranslations("channels");
  const publishing = useTranslations("publishing");
  const language = useTranslations("language");
  const copy = useTranslations("copy");
  const common = useTranslations("common");
  const { data, error, loading, reload } = useResource<BotDetail>(`/bots/${params.id}`);
  if (!data) {
    return <PageState loading={loading} error={error} onRetry={() => void reload()} />;
  }
  const labels: Record<string, string> = {
    ar: language("arabic"),
    en: language("english"),
  };
  return (
    <div>
      <BackLink href="/bots" />
      <Section title={t("identity")}>
        <Fields
          items={[
            { label: t("username"), value: <UsernameValue username={data.botUsername} /> },
            { label: t("type"), value: <StatusText group="bot" code={data.botType} /> },
            {
              label: t("status"),
              value: <ActiveState isActive={data.isActive} deletedAt={data.deletedAt} />,
            },
            {
              label: t("createdAt"),
              value: <Appointment iso={data.createdAt} timeZone="UTC" />,
            },
            {
              label: t("platformForced"),
              value: data.allowPlatformForced ? t("allowed") : t("optedOut"),
            },
            { label: copy("id"), value: <CopyValue value={data.id} label={copy("id")} /> },
          ]}
        />
      </Section>
      <Section title={t("owner")}>
        <Person
          firstName={data.owner.firstName}
          username={data.owner.username}
          telegramId={data.owner.telegramId}
        />
      </Section>
      <Section title={channels("links")} hint={t("linksHint")}>
        {data.links.length === 0 ? (
          <p className="text-sm text-muted">{common("empty")}</p>
        ) : (
          <RecordList
            rows={data.links}
            rowKey={(link) => link.id}
            columns={[
              {
                header: channels("name"),
                render: (link) => (
                  <Link href={`/channels/${link.channel.id}`} className="text-action underline">
                    <UserContent value={link.channel.title} />
                  </Link>
                ),
              },
              {
                header: channels("username"),
                render: (link) => <UsernameValue username={link.channel.username} />,
              },
              {
                header: channels("status"),
                render: (link) => <StatusText group="link" code={link.status} />,
              },
              {
                header: channels("reason"),
                render: (link) => <UserContent value={link.deactivationReason} />,
              },
            ]}
          />
        )}
      </Section>
      <Section title={t("messages")}>
        <h3 className="text-sm font-medium">{t("welcome")}</h3>
        {Object.entries(data.welcomeMessages).length === 0 ? (
          <p className="text-sm text-muted">{common("none")}</p>
        ) : (
          Object.entries(data.welcomeMessages).map(([key, value]) => (
            <div key={key}>
              <p className="text-xs text-muted">{labels[key] ?? key}</p>
              <UserContent value={value} />
            </div>
          ))
        )}
        <h3 className="text-sm font-medium">{t("footer")}</h3>
        {Object.entries(data.footerTexts).length === 0 ? (
          <p className="text-sm text-muted">{common("none")}</p>
        ) : (
          Object.entries(data.footerTexts).map(([key, value]) => (
            <div key={key}>
              <p className="text-xs text-muted">{labels[key] ?? key}</p>
              <UserContent value={value} />
            </div>
          ))
        )}
      </Section>
      {data.supportList ? (
        <Section title={publishing("listName")} hint={t("supportHint")}>
          <Fields
            items={[
              {
                label: publishing("listName"),
                value: <UserContent value={data.supportList.listName} />,
              },
              {
                label: publishing("schedule"),
                value: (
                  <span dir="ltr" className="[unicode-bidi:isolate]">
                    {data.supportList.timeZone}
                  </span>
                ),
              },
              {
                label: publishing("retention"),
                value: <Count value={data.supportList.retentionMinutes} />,
              },
            ]}
          />
          <Link href={`/publishing/${data.id}`} className="text-sm text-action underline">
            {t("openList")}
          </Link>
        </Section>
      ) : null}
    </div>
  );
}
