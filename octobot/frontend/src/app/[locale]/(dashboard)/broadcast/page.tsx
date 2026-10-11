"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { RecordList, Section } from "@/components/blocks";
import { Appointment, Count, StatusBadge, StatusText } from "@/components/chrome";
import { Alert, Dialog, PageState } from "@/components/feedback";
import { UserContent, UsernameValue } from "@/components/values";
import { BroadcastContentPreviewView } from "@/components/broadcast-content-preview";
import { ApiError, api, apiForm } from "@/lib/api";
import {
  buildLinkButtonRows,
  type LinkButtonEditorEntry,
} from "@/lib/broadcast-link-buttons";
import { useResource } from "@/lib/use-resource";
import type {
  BroadcastAudienceType,
  BroadcastBotOption,
  BroadcastCampaign,
  BroadcastContentKind,
  BroadcastDetail,
  BroadcastPreview,
  BroadcastPreviewEligible,
  BroadcastPreviewExcluded,
} from "@/lib/types";

const MEDIA_KINDS: BroadcastContentKind[] = [
  "PHOTO",
  "VIDEO",
  "AUDIO",
  "VOICE",
  "DOCUMENT",
  "ANIMATION",
];

function deliveryTone(status: string): "active" | "inactive" | "deleted" | "neutral" {
  if (status === "SENT" || status === "COMPLETED") {
    return "active";
  }
  if (status === "FAILED" || status === "EXCLUDED") {
    return "deleted";
  }
  if (status === "UNCERTAIN" || status === "STOPPED") {
    return "inactive";
  }
  return "neutral";
}

export default function BroadcastPage() {
  const t = useTranslations("broadcast");
  const common = useTranslations("common");
  const bots = useResource<{ items: BroadcastBotOption[] }>("/broadcasts/bots");
  const campaigns = useResource<{ items: BroadcastCampaign[] }>("/broadcasts");
  const [text, setText] = useState("");
  const [contentKind, setContentKind] = useState<BroadcastContentKind>("TEXT");
  const [caption, setCaption] = useState("");
  const [linkButtons, setLinkButtons] = useState<LinkButtonEditorEntry[]>([]);
  const [mediaUploadId, setMediaUploadId] = useState<string | null>(null);
  const [mediaName, setMediaName] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [audienceType, setAudienceType] = useState<BroadcastAudienceType>("CHANNELS");
  const [includeBotOwners, setIncludeBotOwners] = useState(true);
  const [targetMode, setTargetMode] = useState<"ALL" | "SELECTED">("ALL");
  const [botIds, setBotIds] = useState<string[]>([]);
  const [includeActive, setIncludeActive] = useState(true);
  const [includeInactive, setIncludeInactive] = useState(false);
  const [includeDeleted, setIncludeDeleted] = useState(false);
  const [preview, setPreview] = useState<BroadcastPreview | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const resultsRef = useRef<HTMLDivElement | null>(null);
  const detail = useResource<BroadcastDetail>(openId ? `/broadcasts/${openId}` : null);
  const detailView = detail.data?.id === openId ? detail.data : null;

  const reloadDetail = detail.reload;
  const reloadCampaigns = campaigns.reload;
  const detailStatus = detailView?.status;
  const deleteSummary = detailView?.deleteSummary;
  const deletePolling =
    detailStatus === "RUNNING" ||
    Boolean(
      deleteSummary &&
        (deleteSummary.pending > 0 ||
          deleteSummary.inProgress > 0 ||
          (detailView?.deleteRequested && deleteSummary.none > 0)),
    );
  useEffect(() => {
    if (!deletePolling) {
      return;
    }
    const timer = window.setInterval(() => {
      void reloadDetail();
      void reloadCampaigns();
    }, 3000);
    return () => window.clearInterval(timer);
  }, [deletePolling, reloadDetail, reloadCampaigns]);

  useEffect(() => {
    if (!openId) {
      return;
    }
    resultsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [openId]);

  function openCampaign(id: string) {
    setError(null);
    setOpenId(id);
  }

  function botLabel(id: string) {
    const match = bots.data?.items.find((bot) => bot.id === id);
    return match ? `@${match.botUsername}` : id;
  }

  function payload() {
    const filteredRows = buildLinkButtonRows(linkButtons);
    return {
      text: contentKind === "TEXT" ? text : "",
      contentKind,
      caption: contentKind === "TEXT" ? null : caption.trim() || null,
      linkButtons: filteredRows ? { rows: filteredRows } : null,
      mediaUploadId: contentKind === "TEXT" ? null : mediaUploadId,
      audienceType,
      targetMode,
      botIds: targetMode === "SELECTED" ? botIds : [],
      includeActive,
      includeInactive,
      includeDeleted,
      includeBotOwners,
    };
  }

  async function uploadMedia(file: File, kind: BroadcastContentKind) {
    setError(null);
    setUploading(true);
    setMediaUploadId(null);
    setMediaName(null);
    setPreview(null);
    try {
      const form = new FormData();
      form.append("contentKind", kind);
      form.append("file", file);
      const result = await apiForm<{
        mediaUploadId: string;
        originalName: string;
      }>(`/broadcasts/media?contentKind=${encodeURIComponent(kind)}`, form);
      setMediaUploadId(result.mediaUploadId);
      setMediaName(result.originalName);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.code : "generic");
    } finally {
      setUploading(false);
    }
  }

  function addLinkButton() {
    setLinkButtons((current) => [
      ...current,
      { text: "", url: "", placement: "new_row", color: "default" },
    ]);
    setPreview(null);
  }

  function updateLinkButton(index: number, patch: Partial<LinkButtonEditorEntry>) {
    setLinkButtons((current) =>
      current.map((button, i) => (i === index ? { ...button, ...patch } : button)),
    );
    setPreview(null);
  }

  function recipientLabel(row: BroadcastPreviewEligible | BroadcastPreviewExcluded) {
    if (row.kind === "channel") {
      return row.title;
    }
    return row.displayName ?? row.username;
  }

  function recipientKey(row: BroadcastPreviewEligible | BroadcastPreviewExcluded) {
    return row.kind === "channel" ? row.channelId : row.userId;
  }

  async function runPreview() {
    setError(null);
    setPreview(null);
    try {
      setPreview(await api<BroadcastPreview>("/broadcasts/preview", {
        method: "POST",
        body: JSON.stringify(payload()),
      }));
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.code : "generic");
    }
  }

  async function send() {
    setConfirming(false);
    setError(null);
    try {
      const created = await api<{ id: string }>("/broadcasts", {
        method: "POST",
        body: JSON.stringify(payload()),
      });
      setOpenId(created.id);
      await campaigns.reload();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.code : "generic");
    }
  }

  async function deleteSent() {
    if (!openId) {
      return;
    }
    setDeleting(false);
    setError(null);
    try {
      await api(`/broadcasts/${openId}/delete-sent`, { method: "POST" });
      await detail.reload();
      await campaigns.reload();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.code : "generic");
    }
  }

  function canRequestTelegramDelete(data: BroadcastDetail) {
    if (data.deleteRequested) {
      return false;
    }
    return data.status === "RUNNING" || data.status === "STOPPED" || data.status === "COMPLETED";
  }

  async function stop() {
    if (!openId) {
      return;
    }
    setStopping(false);
    setError(null);
    try {
      await api(`/broadcasts/${openId}/stop`, { method: "POST" });
      await detail.reload();
      await campaigns.reload();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.code : "generic");
    }
  }

  function toggleBot(id: string) {
    setBotIds((current) =>
      current.includes(id) ? current.filter((entry) => entry !== id) : [...current, id],
    );
    setPreview(null);
  }

  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm text-muted">{t("purpose")}</p>
      <Alert code={error} />
      {openId && detail.error && !detailView ? (
        <p role="alert" className="rounded-xl bg-[#f8e8e8] px-3 py-2 text-sm text-danger">
          {t("detailLoadFailed")}
        </p>
      ) : null}
      <Section title={t("text")}>
        <div className="flex flex-wrap gap-3 text-sm">
          <label className="flex items-center gap-2">
            <input
              type="radio"
              name="contentKind"
              checked={contentKind === "TEXT"}
              onChange={() => {
                setContentKind("TEXT");
                setMediaUploadId(null);
                setMediaName(null);
                setPreview(null);
              }}
            />
            {t("contentKind.TEXT")}
          </label>
          {MEDIA_KINDS.map((kind) => (
            <label key={kind} className="flex items-center gap-2">
              <input
                type="radio"
                name="contentKind"
                checked={contentKind === kind}
                onChange={() => {
                  setContentKind(kind);
                  setText("");
                  setMediaUploadId(null);
                  setMediaName(null);
                  setPreview(null);
                }}
              />
              {t(`contentKind.${kind}`)}
            </label>
          ))}
        </div>
        {contentKind === "TEXT" ? (
          <textarea
            value={text}
            onChange={(event) => {
              setText(event.target.value);
              setPreview(null);
            }}
            rows={6}
            dir="auto"
            className="mt-3 w-full rounded-lg border border-line bg-card px-3 py-2 text-sm"
          />
        ) : (
          <div className="mt-3 flex flex-col gap-3">
            <label className="text-sm">
              {t("mediaUpload")}
              <input
                type="file"
                className="mt-1 block text-sm"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) {
                    void uploadMedia(file, contentKind);
                  }
                }}
              />
            </label>
            {uploading ? <p className="text-sm text-muted">{common("loading")}</p> : null}
            {mediaName ? (
              <p className="text-sm">
                {t("uploadedMedia")}: {mediaName}
              </p>
            ) : null}
            <textarea
              value={caption}
              placeholder={t("captionPlaceholder")}
              onChange={(event) => {
                setCaption(event.target.value);
                setPreview(null);
              }}
              rows={4}
              dir="auto"
              className="w-full rounded-lg border border-line bg-card px-3 py-2 text-sm"
            />
          </div>
        )}
        <fieldset className="mt-4 flex flex-col gap-2">
          <legend className="mb-1 text-sm font-medium">{t("linkButtons")}</legend>
          {linkButtons.map((button, index) => (
            <div key={index} className="flex flex-col gap-2 rounded-lg border border-line p-2">
              <div className="flex flex-wrap gap-2">
                <input
                  type="text"
                  placeholder={t("buttonText")}
                  value={button.text}
                  onChange={(event) => updateLinkButton(index, { text: event.target.value })}
                  className="min-w-[8rem] flex-1 rounded-lg border border-line bg-card px-2 py-1 text-sm"
                />
                <input
                  type="url"
                  placeholder={t("buttonUrl")}
                  value={button.url}
                  onChange={(event) => updateLinkButton(index, { url: event.target.value })}
                  className="min-w-[12rem] flex-[2] rounded-lg border border-line bg-card px-2 py-1 text-sm"
                />
              </div>
              <div className="flex flex-wrap gap-3 text-sm">
                <label className="flex items-center gap-2">
                  <span className="text-muted">{t("placementLabel")}</span>
                  <select
                    value={button.placement}
                    onChange={(event) =>
                      updateLinkButton(index, {
                        placement: event.target.value as LinkButtonEditorEntry["placement"],
                      })
                    }
                    className="rounded-lg border border-line bg-card px-2 py-1"
                  >
                    <option value="new_row">{t("placement.newRow")}</option>
                    <option value="after_previous">{t("placement.afterPrevious")}</option>
                  </select>
                </label>
                <label className="flex items-center gap-2">
                  <span className="text-muted">{t("buttonColorLabel")}</span>
                  <select
                    value={button.color}
                    onChange={(event) =>
                      updateLinkButton(index, {
                        color: event.target.value as LinkButtonEditorEntry["color"],
                      })
                    }
                    className="rounded-lg border border-line bg-card px-2 py-1"
                  >
                    <option value="default">{t("buttonColor.default")}</option>
                    <option value="blue">{t("buttonColor.blue")}</option>
                    <option value="green">{t("buttonColor.green")}</option>
                    <option value="red">{t("buttonColor.red")}</option>
                  </select>
                </label>
              </div>
            </div>
          ))}
          <button
            type="button"
            className="w-fit rounded-lg border border-line px-3 py-1 text-sm"
            onClick={addLinkButton}
          >
            {t("addLinkButton")}
          </button>
        </fieldset>
      </Section>
      <Section title={t("audience")}>
        <div className="flex flex-col gap-2 text-sm">
          {(["CHANNELS", "BOT_USERS", "BOT_OWNERS"] as BroadcastAudienceType[]).map((value) => (
            <label key={value} className="flex items-center gap-2">
              <input
                type="radio"
                name="audienceType"
                checked={audienceType === value}
                onChange={() => {
                  setAudienceType(value);
                  setPreview(null);
                }}
              />
              {t(`audienceType.${value}`)}
            </label>
          ))}
        </div>
        {audienceType === "BOT_USERS" ? (
          <label className="mt-3 flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={includeBotOwners}
              onChange={(event) => {
                setIncludeBotOwners(event.target.checked);
                setPreview(null);
              }}
            />
            {t("includeBotOwners")}
          </label>
        ) : null}
        <p className="mt-3 text-sm text-muted">{t(`audienceHint.${audienceType}`)}</p>
      </Section>
      <Section title={t("targets")}>
        <div className="flex flex-col gap-2 text-sm">
          <label className="flex items-center gap-2">
            <input
              type="radio"
              name="targetMode"
              checked={targetMode === "ALL"}
              onChange={() => {
                setTargetMode("ALL");
                setPreview(null);
              }}
            />
            {t("allBots")}
          </label>
          <label className="flex items-center gap-2">
            <input
              type="radio"
              name="targetMode"
              checked={targetMode === "SELECTED"}
              onChange={() => {
                setTargetMode("SELECTED");
                setPreview(null);
              }}
            />
            {t("selectedBots")}
          </label>
        </div>
        {targetMode === "SELECTED" ? (
          <div className="mt-3 flex flex-col gap-2">
            <PageState
              loading={bots.loading}
              error={bots.error}
              empty={Boolean(bots.data && bots.data.items.length === 0)}
              onRetry={() => void bots.reload()}
            />
            {bots.data?.items.map((bot) => (
              <label key={bot.id} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={botIds.includes(bot.id)}
                  onChange={() => toggleBot(bot.id)}
                />
                <UsernameValue username={bot.botUsername} />
                <StatusText group="bot" code={bot.botType} />
              </label>
            ))}
          </div>
        ) : null}
        <fieldset className="mt-4 flex flex-wrap gap-4 text-sm">
          <legend className="mb-2 font-medium">{t("scope")}</legend>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={includeActive}
              onChange={(event) => {
                setIncludeActive(event.target.checked);
                setPreview(null);
              }}
            />
            {t("includeActive")}
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={includeInactive}
              onChange={(event) => {
                setIncludeInactive(event.target.checked);
                setPreview(null);
              }}
            />
            {t("includeInactive")}
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={includeDeleted}
              onChange={(event) => {
                setIncludeDeleted(event.target.checked);
                setPreview(null);
              }}
            />
            {t("includeDeleted")}
          </label>
        </fieldset>
        <button
          type="button"
          className="mt-4 rounded-lg bg-action px-3 py-1.5 text-sm text-white"
          onClick={() => void runPreview()}
        >
          {t("preview")}
        </button>
      </Section>
      {preview ? (
        <Section
          title={t("previewHeading")}
          hint={preview.preliminary ? t("preliminaryHint") : t("confirmHint")}
        >
          <p className="text-sm">
            {t("uniqueTargets")}: <Count value={preview.summary.uniqueTargets} />
          </p>
          <p className="text-sm">
            {preview.preliminary ? t("preliminaryEligible") : t("eligible")}:{" "}
            <Count value={preview.summary.preliminaryEligible} />
          </p>
          <p className="text-sm">
            {t("excluded")}: <Count value={preview.summary.excluded} />
          </p>
          <BroadcastContentPreviewView content={preview.content} />
          {preview.audienceType !== "CHANNELS" ? (
            <p className="text-sm text-muted">{t("dedupeHint")}</p>
          ) : null}
          {preview.eligible.length === 0 ? (
            <p className="text-sm text-muted">{t("noEligible")}</p>
          ) : null}
          {preview.eligible.length > 0 && preview.audienceType !== "CHANNELS" ? (
            <RecordList
              rows={preview.eligible}
              rowKey={(row) => recipientKey(row)}
              columns={[
                {
                  header: t("recipient"),
                  render: (row) => <UserContent value={recipientLabel(row)} />,
                },
                {
                  header: t("senderBot"),
                  render: (row) =>
                    row.kind === "user" ? (
                      <UserContent value={botLabel(row.senderBotId)} />
                    ) : (
                      <UserContent value={botLabel(row.botId)} />
                    ),
                },
              ]}
            />
          ) : null}
          {preview.excluded.length > 0 ? (
            <RecordList
              rows={preview.excluded}
              rowKey={(row) => recipientKey(row)}
              columns={[
                {
                  header: t("recipient"),
                  render: (row) => <UserContent value={recipientLabel(row)} />,
                },
                {
                  header: t("reason"),
                  render: (row) => <StatusText group="broadcastReason" code={row.reason} />,
                },
              ]}
            />
          ) : null}
          <button
            type="button"
            disabled={preview.eligible.length === 0}
            className="rounded-lg bg-action px-3 py-1.5 text-sm text-white disabled:opacity-40"
            onClick={() => setConfirming(true)}
          >
            {t("confirmSend")}
          </button>
        </Section>
      ) : null}
      <Section title={t("campaigns")}>
        <PageState
          loading={campaigns.loading}
          error={campaigns.error}
          empty={Boolean(campaigns.data && campaigns.data.items.length === 0)}
          onRetry={() => void campaigns.reload()}
        />
        {campaigns.data && campaigns.data.items.length > 0 ? (
          <RecordList
            rows={campaigns.data.items}
            rowKey={(row) => row.id}
            columns={[
              {
                header: t("createdAt"),
                render: (row) => <Appointment iso={row.createdAt} timeZone="UTC" />,
              },
              {
                header: t("audience"),
                render: (row) => <StatusText group="broadcastAudience" code={row.audienceType} />,
              },
              {
                header: t("status"),
                render: (row) => (
                  <StatusBadge tone={deliveryTone(row.status)}>
                    <StatusText group="broadcast" code={row.status} />
                  </StatusBadge>
                ),
              },
              {
                header: t("progress"),
                render: (row) => (
                  <span dir="ltr" className="[unicode-bidi:isolate]">
                    {Object.entries(row.counts)
                      .map(([status, count]) => `${status} ${count}`)
                      .join(" · ")}
                  </span>
                ),
              },
              {
                header: common("open"),
                render: (row) => (
                  <button
                    type="button"
                    className="rounded-lg border border-line px-2 py-1 text-sm"
                    onClick={() => openCampaign(row.id)}
                  >
                    {t("open")}
                  </button>
                ),
              },
            ]}
          />
        ) : null}
      </Section>
      {openId ? (
        <div ref={resultsRef}>
        <Section title={t("results")}>
          <PageState
            loading={detail.loading && !detailView}
            error={detail.error && !detailView ? detail.error : null}
            onRetry={() => void detail.reload()}
          />
          {detailView ? (
            <div className="flex flex-col gap-3">
              <BroadcastContentPreviewView content={detailView.content} />
              <StatusBadge tone={deliveryTone(detailView.status)}>
                <StatusText group="broadcast" code={detailView.status} />
              </StatusBadge>
              <div className="flex flex-wrap gap-2">
                {detailView.status === "RUNNING" ? (
                  <button
                    type="button"
                    className="w-fit rounded-lg border border-line px-3 py-1.5 text-sm"
                    onClick={() => setStopping(true)}
                  >
                    {t("stop")}
                  </button>
                ) : null}
                {canRequestTelegramDelete(detailView) ? (
                  <button
                    type="button"
                    className="w-fit rounded-lg border border-line px-3 py-1.5 text-sm"
                    onClick={() => setDeleting(true)}
                  >
                    {t("deleteSent")}
                  </button>
                ) : null}
              </div>
              {detailView.deleteRequested && detailView.deleteSummary ? (
                <div className="text-sm">
                  <p className="font-medium">{t("deleteSummary")}</p>
                  <p dir="ltr" className="[unicode-bidi:isolate] text-muted">
                    {t("deleteDeleted")}: {detailView.deleteSummary.deleted} · {t("deleteGone")}:{" "}
                    {detailView.deleteSummary.gone} · {t("deleteUnavailable")}:{" "}
                    {detailView.deleteSummary.unavailable} · {t("deletePending")}:{" "}
                    {detailView.deleteSummary.pending} · {t("deleteInProgress")}:{" "}
                    {detailView.deleteSummary.inProgress}
                  </p>
                  {Object.keys(detailView.deleteSummary.unavailableReasons).length > 0 ? (
                    <ul className="mt-1 list-disc ps-5 text-muted">
                      {Object.entries(detailView.deleteSummary.unavailableReasons).map(
                        ([reason, count]) => (
                          <li key={reason}>
                            <StatusText group="broadcastReason" code={reason} />: {count}
                          </li>
                        ),
                      )}
                    </ul>
                  ) : null}
                </div>
              ) : null}
              <RecordList
                rows={detailView.deliveries}
                rowKey={(row) => row.id}
                columns={[
                  {
                    header: t("recipient"),
                    render: (row) => (
                      <span className="flex flex-col items-start">
                        <UserContent value={row.kind === "channel" ? row.title : row.displayName} />
                        <UsernameValue username={row.username} />
                      </span>
                    ),
                  },
                  {
                    header: t("senderBot"),
                    render: (row) => <UserContent value={row.senderBotUsername} />,
                  },
                  {
                    header: t("status"),
                    render: (row) => (
                      <StatusBadge tone={deliveryTone(row.status)}>
                        <StatusText group="delivery" code={row.status} />
                      </StatusBadge>
                    ),
                  },
                  {
                    header: t("reason"),
                    render: (row) =>
                      row.reason ? (
                        <StatusText group="broadcastReason" code={row.reason} />
                      ) : (
                        <UserContent value={null} />
                      ),
                  },
                  {
                    header: t("messageId"),
                    render: (row) => <UserContent value={row.messageId} />,
                  },
                  {
                    header: t("chatId"),
                    render: (row) => <UserContent value={row.chatId} />,
                  },
                  {
                    header: t("deleteMessageStatus"),
                    render: (row) =>
                      row.messageDeleteStatus ? (
                        <StatusBadge tone={deliveryTone(row.messageDeleteStatus)}>
                          <StatusText group="messageDelete" code={row.messageDeleteStatus} />
                        </StatusBadge>
                      ) : (
                        <UserContent value={null} />
                      ),
                  },
                ]}
              />
            </div>
          ) : null}
        </Section>
        </div>
      ) : null}
      <Dialog open={confirming} title={t("confirmSend")} onClose={() => setConfirming(false)}>
        <p className="text-sm">{t("confirmHint")}</p>
        {preview ? <BroadcastContentPreviewView content={preview.content} /> : null}
        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            className="rounded-lg bg-action px-3 py-1.5 text-sm text-white"
            onClick={() => void send()}
          >
            {common("confirm")}
          </button>
          <button
            type="button"
            className="rounded-lg border border-line px-3 py-1.5 text-sm"
            onClick={() => setConfirming(false)}
          >
            {common("cancel")}
          </button>
        </div>
      </Dialog>
      <Dialog open={deleting} title={t("deleteSent")} onClose={() => setDeleting(false)}>
        <p className="text-sm">{t("confirmDeleteSent")}</p>
        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            className="rounded-lg bg-action px-3 py-1.5 text-sm text-white"
            onClick={() => void deleteSent()}
          >
            {common("confirm")}
          </button>
          <button
            type="button"
            className="rounded-lg border border-line px-3 py-1.5 text-sm"
            onClick={() => setDeleting(false)}
          >
            {common("cancel")}
          </button>
        </div>
      </Dialog>
      <Dialog open={stopping} title={t("stop")} onClose={() => setStopping(false)}>
        <p className="text-sm">{t("confirmStop")}</p>
        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            className="rounded-lg bg-action px-3 py-1.5 text-sm text-white"
            onClick={() => void stop()}
          >
            {common("confirm")}
          </button>
          <button
            type="button"
            className="rounded-lg border border-line px-3 py-1.5 text-sm"
            onClick={() => setStopping(false)}
          >
            {common("cancel")}
          </button>
        </div>
      </Dialog>
    </div>
  );
}
