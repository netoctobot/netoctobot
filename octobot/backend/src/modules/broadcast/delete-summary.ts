import type { BroadcastMessageDeleteStatus } from "@prisma/client";

export interface BroadcastDeleteSummary {
  deleted: number;
  gone: number;
  unavailable: number;
  pending: number;
  inProgress: number;
  none: number;
  unavailableReasons: Record<string, number>;
  active: boolean;
}

export function summarizeMessageDeletes(
  rows: Array<{ deleteStatus: BroadcastMessageDeleteStatus; deleteReason: string | null }>,
  deleteRequested: boolean,
): BroadcastDeleteSummary {
  const summary: BroadcastDeleteSummary = {
    deleted: 0,
    gone: 0,
    unavailable: 0,
    pending: 0,
    inProgress: 0,
    none: 0,
    unavailableReasons: {},
    active: deleteRequested,
  };
  for (const row of rows) {
    switch (row.deleteStatus) {
      case "DELETED":
        summary.deleted += 1;
        break;
      case "GONE":
        summary.gone += 1;
        break;
      case "UNAVAILABLE":
        summary.unavailable += 1;
        if (row.deleteReason) {
          summary.unavailableReasons[row.deleteReason] =
            (summary.unavailableReasons[row.deleteReason] ?? 0) + 1;
        }
        break;
      case "PENDING":
        summary.pending += 1;
        break;
      case "IN_PROGRESS":
        summary.inProgress += 1;
        break;
      default:
        summary.none += 1;
    }
  }
  return summary;
}

export function deleteWorkInFlight(summary: BroadcastDeleteSummary): boolean {
  return summary.active && (summary.pending > 0 || summary.inProgress > 0);
}
