import assert from "node:assert/strict";
import test from "node:test";
import { assertSingleChannel, MixedChannelBatchError, planReadRequests } from "./batch-plan.js";
import { buildFixturePosts } from "./fixture.js";

test("request count follows channels and readers, not a flat post total", () => {
  const posts = buildFixturePosts();
  const oneReader = planReadRequests({
    posts,
    readers: ["BOT_CHANNELS_GET_MESSAGES"],
    batchSize: 20,
  });
  const twoReaders = planReadRequests({
    posts,
    readers: ["BOT_CHANNELS_GET_MESSAGES", "USER_GET_MESSAGES_VIEWS"],
    batchSize: 20,
  });
  const oneChannel = planReadRequests({
    posts: posts.map((post, index) => ({
      channelId: "only",
      messageId: `m-${index + 1}`,
    })),
    readers: ["BOT_CHANNELS_GET_MESSAGES"],
    batchSize: 20,
  });

  assert.equal(posts.length, 100);
  assert.equal(oneReader.length, 7);
  assert.equal(twoReaders.length, 14);
  assert.equal(oneChannel.length, 5);
  assert.equal(
    oneReader.every((request) => request.messageIds.length <= 20),
    true,
  );
  for (const request of oneReader) {
    assert.doesNotThrow(() => assertSingleChannel([request.channelId]));
  }
});

test("a batch that mixes channels is rejected", () => {
  assert.throws(() => assertSingleChannel(["channel-a", "channel-b"]), MixedChannelBatchError);
});
