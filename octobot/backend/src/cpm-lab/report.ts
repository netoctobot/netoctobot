import type { ReaderState, RunReportData, StoredReading, StoredRequest } from "./store.js";
import { labReaders, type LabReader } from "./types.js";

export const NOT_PROVEN = [
  "Stable counters across these reads on one post do not prove that increment=false never adds views.",
  "Readable views do not prove the measurement is valid for billing.",
  "Other private channels, forwarded posts, deleted posts, load, and long durations are not covered. They belong to A3 and A4.",
  "Library traffic that does not pass through invoke is not fully measured.",
] as const;

type Counts = { sent: number; succeeded: number; failed: number; abandoned: number; started: number };

function counts(requests: readonly StoredRequest[]): Counts & { errors: Record<string, number> } {
  const errors: Record<string, number> = {};
  for (const request of requests) {
    if (request.status === "FAILED" && request.errorClass) {
      errors[request.errorClass] = (errors[request.errorClass] ?? 0) + 1;
    }
  }
  return {
    sent: requests.length,
    succeeded: requests.filter((request) => request.status === "SUCCEEDED").length,
    failed: requests.filter((request) => request.status === "FAILED").length,
    abandoned: requests.filter((request) => request.status === "ABANDONED").length,
    started: requests.filter((request) => request.status === "STARTED").length,
    errors,
  };
}

function byReader<T>(build: (reader: LabReader) => T): Record<LabReader, T> {
  return Object.fromEntries(labReaders.map((reader) => [reader, build(reader)])) as Record<LabReader, T>;
}

export function buildLabReport(input: {
  trial: RunReportData | null;
  preflight: RunReportData | null;
  readerStates: readonly ReaderState[];
}) {
  const trial = input.trial;
  const report = {
    commercialCpmEnabled: false as const,
    notProven: NOT_PROVEN,
    readerStates: input.readerStates.map((state) => ({
      reader: state.reader,
      nextAllowedAt: state.nextAllowedAt?.toISOString() ?? null,
      stoppedAt: state.stoppedAt?.toISOString() ?? null,
      stopReason: state.stopReason,
    })),
    preflight: input.preflight ? runSection(input.preflight) : null,
    trial: trial ? trialSection(trial) : null,
  };
  return report;
}

function runSection(data: RunReportData) {
  return {
    runId: data.run.id,
    status: data.run.status,
    stopReason: data.run.stopReason,
    startedAt: data.run.startedAt.toISOString(),
    stoppedAt: data.run.stoppedAt?.toISOString() ?? null,
    peerResolution: counts(data.requests.filter((request) => request.purpose === "PEER_RESOLUTION")),
    reads: byReader((reader) =>
      counts(data.requests.filter((request) => request.purpose === "PREFLIGHT_READ" && request.reader === reader)),
    ),
    retries: counts(data.requests.filter((request) => request.purpose === "RETRY")),
    readings: data.readings.map(readingView),
    libraryTraffic: data.run.libraryTraffic ?? null,
    alerts: data.alerts.map((alert) => ({ kind: alert.kind, detail: alert.detail, at: alert.createdAt.toISOString() })),
  };
}

function trialSection(data: RunReportData) {
  const settings = (data.run.settings ?? {}) as { rounds?: number; readers?: string[] };
  const rounds = typeof settings.rounds === "number" ? settings.rounds : 0;
  const readers = Array.isArray(settings.readers) ? settings.readers.length : labReaders.length;
  const baseReads = data.requests.filter((request) => request.purpose === "TRIAL_READ");
  const requestById = new Map(data.requests.map((request) => [request.id, request]));
  const series = byReader((reader) =>
    data.readings
      .filter((reading) => requestById.get(reading.requestId)?.reader === reader)
      .map((reading) => ({ round: requestById.get(reading.requestId)?.slotIndex ?? null, ...readingView(reading) })),
  );
  const botViews = series.BOT_CHANNELS_GET_MESSAGES;
  const userViews = series.USER_GET_MESSAGES_VIEWS;
  const differences: Array<{ round: number; bot: number; user: number; difference: number }> = [];
  for (const bot of botViews) {
    const user = userViews.find((candidate) => candidate.round === bot.round);
    if (bot.round !== null && typeof bot.views === "number" && typeof user?.views === "number") {
      differences.push({ round: bot.round, bot: bot.views, user: user.views, difference: bot.views - user.views });
    }
  }
  return {
    ...runSection(data),
    baseTrialReads: {
      planned: rounds * readers,
      ...counts(baseReads),
      byReader: byReader((reader) => counts(baseReads.filter((request) => request.reader === reader))),
      skippedSlots: data.alerts
        .filter((alert) => alert.kind === "slot_skipped")
        .map((alert) => alert.detail),
    },
    series,
    botViewsVisible: botViews.length === 0 ? null : botViews.some((reading) => typeof reading.views === "number"),
    differences,
    floodEvents: data.floodEvents.map((event) => ({
      reader: event.reader,
      seconds: event.seconds,
      occurredAt: event.occurredAt.toISOString(),
      nextAllowedAt: event.nextAllowedAt.toISOString(),
    })),
    manualEvents: data.manualEvents.map((event) => ({
      kind: event.kind,
      occurredAt: event.occurredAt.toISOString(),
      note: event.note,
    })),
    counterRenewal: counterRenewal(data, series),
  };
}

type SeriesPoint = ReturnType<typeof readingView> & { round: number | null };

function counterRenewal(data: RunReportData, series: Record<LabReader, SeriesPoint[]>) {
  const event = data.manualEvents.find((candidate) => candidate.kind === "VIEW_OPENED");
  if (!event) {
    return {
      status: "undetermined" as const,
      reason: "No manual view event was recorded, so renewal of the counter after a real view remains undetermined.",
    };
  }
  const at = event.occurredAt.getTime();
  return {
    status: "observed" as const,
    eventAt: event.occurredAt.toISOString(),
    byReader: byReader((reader) => {
      const points = series[reader].filter((point) => typeof point.views === "number");
      const before = [...points].reverse().find((point) => Date.parse(point.observedAt) < at);
      const after = points.find((point) => Date.parse(point.observedAt) >= at);
      const firstIncrease = points.find(
        (point) => Date.parse(point.observedAt) >= at && before && (point.views ?? 0) > (before.views ?? 0),
      );
      return {
        viewsBefore: before?.views ?? null,
        firstViewsAfter: after?.views ?? null,
        firstIncreaseAt: firstIncrease?.observedAt ?? null,
        delayMs: firstIncrease ? Date.parse(firstIncrease.observedAt) - at : null,
      };
    }),
  };
}

function readingView(reading: StoredReading) {
  return {
    messageId: reading.telegramMessageId.toString(),
    views: reading.views,
    resultKind: reading.resultKind,
    observedAt: reading.observedAt.toISOString(),
  };
}
