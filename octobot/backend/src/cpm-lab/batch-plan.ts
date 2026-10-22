import type { LabReader, PlannedRequest, TrackedPost } from "./types.js";

export class MixedChannelBatchError extends Error {
  constructor() {
    super("A CPM lab request cannot mix channels");
    this.name = "MixedChannelBatchError";
  }
}

export function assertSingleChannel(channelIds: readonly string[]): void {
  if (new Set(channelIds).size > 1) {
    throw new MixedChannelBatchError();
  }
}

export function planReadRequests(input: {
  posts: readonly TrackedPost[];
  readers: readonly LabReader[];
  batchSize: number;
}): PlannedRequest[] {
  if (!Number.isInteger(input.batchSize) || input.batchSize < 1) {
    throw new Error("Batch size must be a positive integer");
  }
  const byChannel = new Map<string, string[]>();
  for (const post of input.posts) {
    const messageIds = byChannel.get(post.channelId) ?? [];
    if (!messageIds.includes(post.messageId)) {
      messageIds.push(post.messageId);
    }
    byChannel.set(post.channelId, messageIds);
  }

  const requests: PlannedRequest[] = [];
  for (const reader of input.readers) {
    for (const [channelId, messageIds] of byChannel) {
      for (let index = 0; index < messageIds.length; index += input.batchSize) {
        const batch = messageIds.slice(index, index + input.batchSize);
        assertSingleChannel(batch.map(() => channelId));
        requests.push({ reader, channelId, messageIds: batch });
      }
    }
  }
  return requests;
}
