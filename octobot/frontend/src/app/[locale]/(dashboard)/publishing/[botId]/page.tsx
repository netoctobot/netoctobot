"use client";

import { useState } from "react";
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
import { Alert, Dialog, PageState } from "@/components/feedback";
import { CopyValue, UserContent, UsernameValue } from "@/components/values";
import { ApiError, api } from "@/lib/api";
import { normalizeAdminReason } from "@/lib/reason";
import { useResource } from "@/lib/use-resource";
import type { PublishingDetail } from "@/lib/types";

export default function PublishingDetailPage() {
  const params = useParams<{ botId: string }>();
  const t = useTranslations("publishing");
  const common = useTranslations("common");
  const copy = useTranslations("copy");
  const { data, error, loading, reload } = useResource<PublishingDetail>(
    `/publishing/${params.botId}`,
  );
  const [membershipId, setMembershipId] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  async function disableMembership() {
    if (!membershipId) {
      return;
    }
    const normalized = normalizeAdminReason(reason);
    if (!normalized) {
      setFormError("invalid_reason");
      return;
    }
    setFormError(null);
    try {
      await api(
        `/publishing/${params.botId}/memberships/${membershipId}/admin-disable`,
        { method: "POST", body: JSON.stringify({ reason: normalized }) },
      );
      setMembershipId(null);
      setReason("");
      setSaved(true);
      await reload();
    } catch (caught) {
      setFormError(caught instanceof ApiError ? caught.code : "generic");
    }
  }

  if (!data) {
    return <PageState loading={loading} error={error} onRetry={() => void reload()} />;
  }
  const zone = data.settings?.timeZone ?? "UTC";
  return (
    <div>
      <BackLink href="/publishing" />
      <p className="mt-3 text-sm text-muted">{t("purpose")}</p>
      <Alert code={saved ? "saved" : null} tone="saved" />
      <Section title={t("bot")}>
        <Fields
          items={[
            {
              label: t("bot"),
              value: <UsernameValue username={data.botUsername} />,
            },
            {
              label: common("active"),
              value: <ActiveState isActive={data.isActive} deletedAt={data.deletedAt} />,
            },
          ]}
        />
        {data.settings ? (
          <Fields
            items={[
              {
                label: t("listName"),
                value: <UserContent value={data.settings.listName} />,
              },
              {
                label: t("publishing"),
                value: data.settings.publishingEnabled ? t("on") : t("off"),
              },
              {
                label: t("schedule"),
                value: (
                  <span className="flex flex-wrap items-center gap-2">
                    <StatusText group="scheduleMode" code={data.settings.scheduleMode} />
                    <span dir="ltr" className="[unicode-bidi:isolate]">
                      {data.settings.timeZone}
                    </span>
                  </span>
                ),
              },
              {
                label: t("retention"),
                value: <Count value={data.settings.retentionMinutes} />,
              },
              {
                label: t("acceptance"),
                value: <StatusText group="acceptanceMode" code={data.settings.acceptanceMode} />,
              },
              {
                label: t("format"),
                value: <StatusText group="format" code={data.settings.format} />,
              },
              {
                label: t("contactUrl"),
                value:
                  data.settings.contactUrl?.startsWith("https://") ||
                  data.settings.contactUrl?.startsWith("tg://") ? (
                    <a
                      href={data.settings.contactUrl}
                      dir="ltr"
                      className="[unicode-bidi:isolate] text-action underline"
                      rel="noreferrer"
                    >
                      {data.settings.contactUrl}
                    </a>
                  ) : (
                    <UserContent value={data.settings.contactUrl} />
                  ),
              },
              {
                label: t("customTimes"),
                value:
                  data.settings.customTimes.length === 0 ? (
                    common("none")
                  ) : (
                    <span className="flex flex-wrap gap-2">
                      {data.settings.customTimes.map((clock) => (
                        <span key={clock} dir="ltr" className="[unicode-bidi:isolate]">
                          {clock}
                        </span>
                      ))}
                    </span>
                  ),
              },
            ]}
          />
        ) : (
          <p className="text-sm text-muted">{common("none")}</p>
        )}
      </Section>
      <Section title={t("memberships")}>
        <RecordList
          rows={data.memberships}
          rowKey={(membership) => membership.id}
          columns={[
            {
              header: t("listName"),
              render: (membership) => (
                <span className="flex flex-col items-start">
                  <UserContent value={membership.channel.title} />
                  <UsernameValue username={membership.channel.username} />
                </span>
              ),
            },
            {
              header: t("acceptance"),
              render: (membership) => (
                <span className="flex flex-col items-start gap-1">
                  <StatusText group="acceptance" code={membership.acceptanceStatus} />
                  {membership.deletedAt ? (
                    <ActiveState isActive={false} deletedAt={membership.deletedAt} />
                  ) : null}
                </span>
              ),
            },
            {
              header: t("reason"),
              render: (membership) => <UserContent value={membership.adminDisableReason} />,
            },
            {
              header: t("participant"),
              render: (membership) => <YesNo value={membership.participantDisabled} />,
            },
            {
              header: t("permissions"),
              render: (membership) => <YesNo value={membership.permissionsLost} />,
            },
            {
              header: t("invite"),
              render: (membership) => <YesNo value={membership.inviteUnavailable} />,
            },
            {
              header: t("disable"),
              render: (membership) =>
                membership.adminDisabled ? (
                  t("alreadyDisabled")
                ) : membership.acceptanceStatus === "ACCEPTED" && !membership.deletedAt ? (
                  <button
                    type="button"
                    className="rounded-lg bg-action px-3 py-1.5 text-sm text-white"
                    onClick={() => {
                      setSaved(false);
                      setFormError(null);
                      setMembershipId(membership.id);
                    }}
                  >
                    {t("disable")}
                  </button>
                ) : (
                  common("none")
                ),
            },
          ]}
        />
      </Section>
      <Section title={t("cycles")}>
        {data.cycles.length === 0 ? <p className="text-sm text-muted">{common("empty")}</p> : null}
        {data.cycles.map((cycle) => (
          <div key={cycle.id} className="flex flex-col gap-3 border-t border-line pt-3">
            <div className="flex flex-wrap gap-3 text-sm">
              <StatusText group="cycle" code={cycle.status} />
              <Appointment iso={cycle.scheduledAt} timeZone={zone} />
              <Appointment iso={cycle.deleteAt} timeZone={zone} />
            </div>
            <RecordList
              rows={cycle.publications}
              rowKey={(publication) => publication.id}
              columns={[
                {
                  header: t("publications"),
                  render: (publication) => (
                    <span className="flex flex-col items-start gap-1">
                      <UserContent value={publication.channel.title} />
                      <StatusText group="publication" code={publication.status} />
                    </span>
                  ),
                },
                {
                  header: t("messageId"),
                  render: (publication) =>
                    publication.messageId ? (
                      <CopyValue value={publication.messageId} label={copy("id")} />
                    ) : (
                      common("none")
                    ),
                },
                {
                  header: t("deleteAt"),
                  render: (publication) => (
                    <Appointment iso={publication.deleteAt} timeZone={zone} />
                  ),
                },
              ]}
            />
          </div>
        ))}
      </Section>
      <Dialog
        open={membershipId !== null}
        title={t("disable")}
        onClose={() => setMembershipId(null)}
      >
        <form
          className="flex flex-col gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            void disableMembership();
          }}
        >
          <p className="text-sm">{t("disableResult")}</p>
          <label className="flex flex-col gap-1 text-sm">
            {t("reason")}
            <textarea
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              className="min-h-24 rounded-lg border border-line bg-paper p-3"
            />
          </label>
          <p className="text-sm text-muted">{t("reasonHint")}</p>
          <Alert code={formError} />
          <div className="flex flex-wrap gap-2">
            <button type="submit" className="rounded-lg bg-action px-4 py-2 text-sm text-white">
              {common("confirm")}
            </button>
            <button
              type="button"
              onClick={() => setMembershipId(null)}
              className="rounded-lg border border-line px-4 py-2 text-sm"
            >
              {common("cancel")}
            </button>
          </div>
        </form>
      </Dialog>
    </div>
  );
}
