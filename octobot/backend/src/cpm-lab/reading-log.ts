import type {
  ObservationSource,
  ObservedMessage,
  ReadingRecord,
  RpcRequestRecord,
  LabReader,
} from "./types.js";

export type SaveResultInput = {
  runId: string;
  reader: LabReader;
  channelId: string;
  idempotencyKey: string;
  source: ObservationSource;
  errorClass?: string | null;
  messages: readonly ObservedMessage[];
};

export type SaveResult = {
  requestId: string;
  inserted: number;
  alreadyStored: boolean;
  readingCount: number;
  unchanged: boolean;
};

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
      const stored = this.readingsFor(existing.id);
      return {
        requestId: existing.id,
        inserted: 0,
        alreadyStored: true,
        readingCount: stored.length,
        unchanged: sameObservations(stored, input.messages),
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
    };
  }

  readingsFor(requestId: string): ReadingRecord[] {
    return this.readings.filter((reading) => reading.requestId === requestId);
  }
}

function sameObservations(
  stored: readonly ReadingRecord[],
  incoming: readonly ObservedMessage[],
): boolean {
  const uniqueIncoming = new Map<string, number | null>();
  for (const message of incoming) {
    if (!uniqueIncoming.has(message.messageId)) {
      uniqueIncoming.set(message.messageId, message.views);
    }
  }
  if (stored.length !== uniqueIncoming.size) {
    return false;
  }
  return stored.every(
    (reading) => uniqueIncoming.get(reading.messageId) === reading.views,
  );
}
