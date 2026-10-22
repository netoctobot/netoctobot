export const labReaders = [
  "BOT_CHANNELS_GET_MESSAGES",
  "USER_GET_MESSAGES_VIEWS",
] as const;

export type LabReader = (typeof labReaders)[number];

export type ObservationSource = "TELEGRAM" | "INJECTED";

export type TrackedPost = {
  channelId: string;
  messageId: string;
};

export type PlannedRequest = {
  reader: LabReader;
  channelId: string;
  messageIds: string[];
};

export type ObservedMessage = {
  messageId: string;
  views: number | null;
};

export type RpcRequestRecord = {
  id: string;
  runId: string;
  reader: LabReader;
  channelId: string;
  idempotencyKey: string;
  source: ObservationSource;
  errorClass: string | null;
};

export type ReadingRecord = {
  requestId: string;
  runId: string;
  channelId: string;
  messageId: string;
  views: number | null;
  source: ObservationSource;
};

export const labAccountPolicy = {
  primaryAccountRequiredForLiveRun: true,
  secondAccountRequiredForInitialSetup: false,
  automaticAccountSwitch: false,
} as const;
