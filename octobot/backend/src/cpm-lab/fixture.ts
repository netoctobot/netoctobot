import { planReadRequests } from "./batch-plan.js";
import { classifyLabError } from "./errors.js";
import { ReadingLog } from "./reading-log.js";
import { labAccountPolicy, type LabReader, type TrackedPost } from "./types.js";

export const FIXTURE_BATCH_SIZE = 20;
export const FIXTURE_RUN_ID = "fixture-run";

export type FixtureReport = {
  mode: "fixture";
  provesTelegramBehavior: false;
  commercialCpmEnabled: false;
  telegramNotContacted: true;
  databaseNotContacted: true;
  libraryNotContacted: true;
  secondAccountRequiredForInitialSetup: false;
  automaticAccountSwitch: false;
  channels: number;
  posts: number;
  readers: LabReader[];
  batchSize: number;
  plannedRequests: number;
  plannedRequestsIfPostsWereOneChannel: number;
  batches: Array<{ channelId: string; reader: LabReader; messageCount: number }>;
  requestsStored: number;
  readingsStored: number;
    multiPostSave: {
      messagesInResponse: number;
      readingsStored: number;
      rereadInserted: number;
      readingsAfterReread: number;
      viewsUnchanged: boolean;
    };
  injectedFloodWait: {
    errorClass: "FLOOD_WAIT";
    seconds: number;
    countedInTelegramMetrics: false;
    punitiveBan: false;
  };
  note: string;
};

export function buildFixturePosts(): TrackedPost[] {
  return [
    ...numberedPosts("channel-a", 10, "a"),
    ...numberedPosts("channel-b", 25, "b"),
    ...numberedPosts("channel-c", 65, "c"),
  ];
}

export function runFixture(): FixtureReport {
  const posts = buildFixturePosts();
  const readers: LabReader[] = ["BOT_CHANNELS_GET_MESSAGES"];
  const planned = planReadRequests({
    posts,
    readers,
    batchSize: FIXTURE_BATCH_SIZE,
  });
  const singleChannel = planReadRequests({
    posts: posts.map((post, index) => ({
      channelId: "single-channel",
      messageId: `m-${index + 1}`,
    })),
    readers,
    batchSize: FIXTURE_BATCH_SIZE,
  });
  const log = new ReadingLog();
  const messages = [
    { messageId: "a-1", views: 3 },
    { messageId: "a-2", views: 5 },
    { messageId: "a-3", views: 8 },
  ];
  const saved = log.saveResult({
    runId: FIXTURE_RUN_ID,
    reader: readers[0]!,
    channelId: "channel-a",
    idempotencyKey: "fixture-multi",
    source: "INJECTED",
    messages,
  });
  const reread = log.saveResult({
    runId: FIXTURE_RUN_ID,
    reader: readers[0]!,
    channelId: "channel-a",
    idempotencyKey: "fixture-multi",
    source: "INJECTED",
    messages,
  });
  const flood = classifyLabError({ message: "FLOOD_WAIT_9" });
  const channelCount = new Set(posts.map((post) => post.channelId)).size;

  return {
    mode: "fixture",
    provesTelegramBehavior: false,
    commercialCpmEnabled: false,
    telegramNotContacted: true,
    databaseNotContacted: true,
    libraryNotContacted: true,
    secondAccountRequiredForInitialSetup:
      labAccountPolicy.secondAccountRequiredForInitialSetup,
    automaticAccountSwitch: labAccountPolicy.automaticAccountSwitch,
    channels: channelCount,
    posts: posts.length,
    readers,
    batchSize: FIXTURE_BATCH_SIZE,
    plannedRequests: planned.length,
    plannedRequestsIfPostsWereOneChannel: singleChannel.length,
    batches: planned.map((request) => ({
      channelId: request.channelId,
      reader: request.reader,
      messageCount: request.messageIds.length,
    })),
    requestsStored: log.requests.length,
    readingsStored: log.readings.length,
    multiPostSave: {
      messagesInResponse: messages.length,
      readingsStored: saved.inserted,
      rereadInserted: reread.inserted,
      readingsAfterReread: reread.readingCount,
      viewsUnchanged: reread.unchanged,
    },
    injectedFloodWait: {
      errorClass: "FLOOD_WAIT",
      seconds: flood.floodWaitSeconds ?? 0,
      countedInTelegramMetrics: false,
      punitiveBan: flood.punitiveBan,
    },
    note: "عدد الطلبات يتبع توزيع المنشورات على القنوات وعدد القراء. مئة منشور في ثلاث قنوات تساوي 7 طلبات، بينما القناة الواحدة كانت ستساوي 5. هذا التقرير بيانات محلية ولا يثبت سلوك Telegram.",
  };
}

function numberedPosts(channelId: string, count: number, prefix: string): TrackedPost[] {
  return Array.from({ length: count }, (_, index) => ({
    channelId,
    messageId: `${prefix}-${index + 1}`,
  }));
}
