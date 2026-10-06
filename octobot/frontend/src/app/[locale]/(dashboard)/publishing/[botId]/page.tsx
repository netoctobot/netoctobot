"use client";

import { useState } from "react";
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
  Alert,
  DataCell,
  DataRow,
  DataTable,
  Dialog,
  PageState,
} from "@/components/feedback";
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
    return (
      <PageState loading={loading} error={error} onRetry={() => void reload()} />
    );
  }
  const zone = data.settings?.timeZone ?? "UTC";
  return (
    <div className="flex flex-col gap-5">
      <BackLink href="/publishing" />
      <Alert code={saved ? "saved" : null} tone="saved" />
      <section className="flex flex-col gap-2 rounded-2xl border border-line bg-card p-5">
        <UsernameValue username={data.botUsername} />
        <ActiveState isActive={data.isActive} deletedAt={data.deletedAt} />
        {data.settings ? (
          <>
            <h2 className="text-xl font-semibold">
              <UserContent value={data.settings.listName} />
            </h2>
            <p>
              {t("publishing")}: {data.settings.publishingEnabled ? t("on") : t("off")}
            </p>
            <p>
              {t("schedule")}:{" "}
              <StatusText group="scheduleMode" code={data.settings.scheduleMode} />{" "}
              <span dir="ltr" className="[unicode-bidi:isolate]">
                {data.settings.timeZone}
              </span>
            </p>
            <p>
              {t("retention")}: <Count value={data.settings.retentionMinutes} />
            </p>
            <p>
              {t("acceptance")}:{" "}
              <StatusText group="acceptanceMode" code={data.settings.acceptanceMode} />
            </p>
            <p>
              {t("format")}: <StatusText group="format" code={data.settings.format} />
            </p>
            <p>
              {t("contactUrl")}:{" "}
              {data.settings.contactUrl?.startsWith("https://") ||
              data.settings.contactUrl?.startsWith("tg://") ? (
                <a
                  href={data.settings.contactUrl}
                  dir="ltr"
                  className="[unicode-bidi:isolate] text-accent underline"
                  rel="noreferrer"
                >
                  {data.settings.contactUrl}
                </a>
              ) : (
                <UserContent value={data.settings.contactUrl} />
              )}
            </p>
            <p>{t("customTimes")}</p>
            <ul className="flex flex-wrap gap-2">
              {data.settings.customTimes.length === 0 ? (
                <li>{common("none")}</li>
              ) : (
                data.settings.customTimes.map((clock) => (
                  <li key={clock} dir="ltr" className="[unicode-bidi:isolate]">
                    {clock}
                  </li>
                ))
              )}
            </ul>
          </>
        ) : (
          <p>{common("none")}</p>
        )}
      </section>
      <h2 className="text-lg font-semibold">{t("memberships")}</h2>
      <DataTable
        headers={[
          t("listName"),
          t("acceptance"),
          t("reason"),
          t("participant"),
          t("permissions"),
          t("invite"),
          t("disable"),
        ]}
      >
        {data.memberships.map((membership) => (
          <DataRow key={membership.id}>
            <DataCell>
              <UserContent value={membership.channel.title} />
              <UsernameValue username={membership.channel.username} />
              <CopyValue value={membership.channel.telegramId} label={copy("id")} />
            </DataCell>
            <DataCell>
              <StatusText group="acceptance" code={membership.acceptanceStatus} />
              {membership.deletedAt ? <ActiveState isActive={false} deletedAt={membership.deletedAt} /> : null}
            </DataCell>
            <DataCell>
              <UserContent value={membership.adminDisableReason} />
            </DataCell>
            <DataCell>
              <YesNo value={membership.participantDisabled} />
            </DataCell>
            <DataCell>
              <YesNo value={membership.permissionsLost} />
            </DataCell>
            <DataCell>
              <YesNo value={membership.inviteUnavailable} />
            </DataCell>
            <DataCell>
              {membership.adminDisabled ? (
                t("alreadyDisabled")
              ) : membership.acceptanceStatus === "ACCEPTED" && !membership.deletedAt ? (
                <button
                  type="button"
                  className="rounded-full bg-accent px-3 py-1.5 text-sm text-card"
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
              )}
            </DataCell>
          </DataRow>
        ))}
      </DataTable>
      <h2 className="text-lg font-semibold">{t("cycles")}</h2>
      {data.cycles.map((cycle) => (
        <section key={cycle.id} className="flex flex-col gap-3">
          <div className="flex flex-wrap gap-3">
            <StatusText group="cycle" code={cycle.status} />
            <Appointment iso={cycle.scheduledAt} timeZone={zone} />
            <Appointment iso={cycle.deleteAt} timeZone={zone} />
          </div>
          <DataTable headers={[t("publications"), t("messageId"), t("deleteAt")]}>
            {cycle.publications.map((publication) => (
              <DataRow key={publication.id}>
                <DataCell>
                  <UserContent value={publication.channel.title} />
                  <StatusText group="publication" code={publication.status} />
                </DataCell>
                <DataCell>
                  {publication.messageId ? (
                    <CopyValue value={publication.messageId} label={copy("id")} />
                  ) : (
                    common("none")
                  )}
                </DataCell>
                <DataCell>
                  <Appointment iso={publication.deleteAt} timeZone={zone} />
                </DataCell>
              </DataRow>
            ))}
          </DataTable>
        </section>
      ))}
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
          <label className="flex flex-col gap-1 text-sm">
            {t("reason")}
            <textarea
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              className="min-h-24 rounded-xl border border-line bg-paper p-3"
            />
          </label>
          <p className="text-sm text-muted">{t("reasonHint")}</p>
          <Alert code={formError} />
          <div className="flex flex-wrap gap-2">
            <button
              type="submit"
              className="rounded-full bg-accent px-4 py-2 text-sm text-card"
            >
              {common("confirm")}
            </button>
            <button
              type="button"
              onClick={() => setMembershipId(null)}
              className="rounded-full border border-line px-4 py-2 text-sm"
            >
              {common("cancel")}
            </button>
          </div>
        </form>
      </Dialog>
    </div>
  );
}
