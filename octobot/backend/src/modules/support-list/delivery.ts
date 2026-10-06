import { GrammyError, HttpError } from "grammy";
import { deleteAtFromSuccessfulSend } from "./schedule.js";

export type SendFailureKind = "retry" | "rejected" | "unknown";

export class PublishDeferredError extends Error {
  readonly resumeAt: Date;

  constructor(resumeAt: Date) {
    super("The previous list is still inside its keep window");
    this.name = "PublishDeferredError";
    this.resumeAt = resumeAt;
  }
}

export function classifySendFailure(error: unknown): SendFailureKind {
  if (error instanceof GrammyError) {
    if (error.error_code === 429) {
      return "retry";
    }
    if (error.error_code >= 500) {
      return "unknown";
    }
    return "rejected";
  }
  if (error instanceof HttpError) {
    return "unknown";
  }
  return "unknown";
}

export interface OccupiedPublication {
  cycleId: string;
  status: string;
  deleteAt: Date;
  sendAttemptedAt: Date | null;
  retentionMinutes?: number;
}

export function occupiedUntil(input: {
  publications: OccupiedPublication[];
  currentCycleId: string;
  retentionMinutes: number;
  now: Date;
}): Date | null {
  let latest: Date | null = null;
  for (const publication of input.publications) {
    if (publication.cycleId === input.currentCycleId) {
      continue;
    }
    let until: Date | null = null;
    if (publication.status === "SENT") {
      until = publication.deleteAt;
    } else if (
      publication.status === "SENDING" ||
      publication.status === "UNCONFIRMED"
    ) {
      until = deleteAtFromSuccessfulSend(
        publication.sendAttemptedAt ?? input.now,
        publication.retentionMinutes ?? input.retentionMinutes,
      );
    }
    if (!until || until.getTime() <= input.now.getTime()) {
      continue;
    }
    if (!latest || until.getTime() > latest.getTime()) {
      latest = until;
    }
  }
  return latest;
}
