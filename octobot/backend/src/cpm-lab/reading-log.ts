import type {
  ObservationSource,
  ObservedMessage,
  ReadingRecord,
  RpcRequestRecord,
  LabReader,
} from "./types.js";

/**
 * In-memory stand-in for the later database write.
 * Lookup is runId + idempotencyKey. channelId, reader, and source stay fixed
 * for that key. A later transaction must reject a different channelId, reader,
 * or source before inserting or updating any row. Readings stay append-only:
 * the first stored views are not rewritten when a replay reports other views.
 */

export type SaveResultInput = {
  runId: string;
  reader: LabReader;
  channelId: string;
  idempotencyKey: string;
  source: ObservationSource;
  errorClass?: string | null;
  messages: readonly ObservedMessage[];
};

export type ReadingViewDifference = {
  messageId: string;
  storedViews: number | null | "absent";
  incomingViews: number | null | "absent";
};

export type SaveResult = {
  requestId: string;
  inserted: number;
  alreadyStored: boolean;
  readingCount: number;
  unchanged: boolean;
  differences: ReadingViewDifference[];
};

export class RequestIdentityConflictError extends Error {
  readonly field: "channelId" | "reader" | "source";

  constructor(field: "channelId" | "reader" | "source") {
    super(`idempotency key reused with a different ${field}`);
    this.name = "RequestIdentityConflictError";
    this.field = field;
  }
}

export class ReadingLog {
  private sequence = 0;
  readonly requests: RpcRequestRecord[] = [];
  readonly readings: ReadingRecord[] = [];

  saveResult(input: SaveResultInput): SaveResult {
    const existing = this.requests.find(
      (request) =>
        request.runId === input.runId &&
        request.idempotencyKey === input.idempotencyKey,
    );
    if (existing) {
      assertSameIdentity(existing, input);
      const stored = this.readingsFor(existing.id);
      const differences = observationDifferences(stored, input.messages);
      return {
        requestId: existing.id,
        inserted: 0,
        alreadyStored: true,
        readingCount: stored.length,
        unchanged: differences.length === 0,
        differences,
      };
    }

    const requestId = `rpc-${this.sequence + 1}`;
    this.sequence += 1;
    this.requests.push({
      id: requestId,
      runId: input.runId,
      reader: input.reader,
      channelId: input.channelId,
      idempotencyKey: input.idempotencyKey,
      source: input.source,
      errorClass: input.errorClass ?? null,
    });

    const seen = new Set<string>();
    for (const message of input.messages) {
      const identity = `${input.channelId}\u0000${message.messageId}`;
      if (seen.has(identity)) {
        continue;
      }
      seen.add(identity);
      this.readings.push({
        requestId,
        runId: input.runId,
        channelId: input.channelId,
        messageId: message.messageId,
        views: message.views,
        source: input.source,
      });
    }

    return {
      requestId,
      inserted: seen.size,
      alreadyStored: false,
      readingCount: seen.size,
      unchanged: true,
      differences: [],
    };
  }

  readingsFor(requestId: string): ReadingRecord[] {
    return this.readings.filter((reading) => reading.requestId === requestId);
  }
}

function assertSameIdentity(
  existing: RpcRequestRecord,
  input: SaveResultInput,
): void {
  if (existing.channelId !== input.channelId) {
    throw new RequestIdentityConflictError("channelId");
  }
  if (existing.reader !== input.reader) {
    throw new RequestIdentityConflictError("reader");
  }
  if (existing.source !== input.source) {
    throw new RequestIdentityConflictError("source");
  }
}

function observationDifferences(
  stored: readonly ReadingRecord[],
  incoming: readonly ObservedMessage[],
): ReadingViewDifference[] {
  const uniqueIncoming = new Map<string, number | null>();
  for (const message of incoming) {
    if (!uniqueIncoming.has(message.messageId)) {
      uniqueIncoming.set(message.messageId, message.views);
    }
  }
  const differences: ReadingViewDifference[] = [];
  const seenStored = new Set<string>();
  for (const reading of stored) {
    seenStored.add(reading.messageId);
    if (!uniqueIncoming.has(reading.messageId)) {
      differences.push({
        messageId: reading.messageId,
        storedViews: reading.views,
        incomingViews: "absent",
      });
      continue;
    }
    const incomingViews = uniqueIncoming.get(reading.messageId);
    if (incomingViews !== reading.views) {
      differences.push({
        messageId: reading.messageId,
        storedViews: reading.views,
        incomingViews: incomingViews ?? null,
      });
    }
  }
  for (const [messageId, views] of uniqueIncoming) {
    if (!seenStored.has(messageId)) {
      differences.push({
        messageId,
        storedViews: "absent",
        incomingViews: views,
      });
    }
  }
  return differences;
}
