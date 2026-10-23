import { Api, sessions, TelegramClient } from "teleproto";
import { LogLevel } from "teleproto/extensions/Logger.js";
import type { TelegramCredentials } from "./config.js";
import type { LabCallOptions, LabRpc } from "./readers.js";
import { RedactingLabLogger } from "./teleproto-surface.js";

/**
 * Client settings for every lab session. teleproto 1.230.1 defaults are
 * requestRetries 5, floodSleepThreshold 60, and Infinity for
 * connectionRetries and reconnectRetries (client/telegramBaseClient.js).
 */
export const LAB_CLIENT_OPTIONS = {
  requestRetries: 1,
  connectionRetries: 3,
  reconnectRetries: 3,
  floodSleepThreshold: 0,
  timeout: 10,
  autoReconnect: true,
  deviceModel: "octobot-cpm-lab",
  systemVersion: "lab",
  appVersion: "cpm-lab-a2",
  langCode: "en",
  systemLangCode: "en",
} as const;

/**
 * Not countable here: PingDelayDisconnect, sent by the update loop every 9
 * seconds through _sender.send (client/updates/dispatch.js), and the
 * connection setup requests the sender issues directly.
 */
export const NOT_FULLY_MEASURED = [
  "PingDelayDisconnect from the teleproto update loop, sent through _sender.send outside invoke",
  "connection setup, initConnection, and reconnects issued by the MTProto sender",
] as const;

export type LibraryTraffic = {
  countedAtInvoke: Record<string, number>;
  notFullyMeasured: readonly string[];
};

export type InvokeLike = (
  request: Api.AnyRequest,
  dcId?: number,
  options?: Api.ApiCallOptions,
) => Promise<unknown>;

/**
 * Wraps the instance invoke. client.api and the update manager call
 * this.invoke (client/TelegramClient.js, client/updates/manager.js), so their
 * requests pass through the wrapper and are counted by class name. Requests
 * sent by the lab are marked and excluded from the library count.
 */
export function instrumentInvoke(target: { invoke: InvokeLike }): LabRpc & {
  traffic(): LibraryTraffic;
} {
  const original = target.invoke.bind(target);
  const labRequests = new WeakSet<object>();
  const counts: Record<string, number> = {};
  target.invoke = (request, dcId, options) => {
    if (!labRequests.has(request)) {
      const name = String((request as { className?: unknown }).className ?? "unknown");
      counts[name] = (counts[name] ?? 0) + 1;
    }
    return original(request, dcId, options);
  };
  return {
    invokeLab(request: Api.AnyRequest, options: LabCallOptions) {
      labRequests.add(request);
      return target.invoke(request, undefined, options);
    },
    traffic() {
      return { countedAtInvoke: { ...counts }, notFullyMeasured: NOT_FULLY_MEASURED };
    },
  };
}

export type LabTelegramSession = LabRpc & {
  client: TelegramClient;
  traffic(): LibraryTraffic;
  saveSession(): string;
  close(): Promise<void>;
};

export async function openLabTelegramClient(input: {
  credentials: TelegramCredentials;
  session: string;
  secrets: readonly string[];
  logSink: (line: string) => void;
  logLevel?: LogLevel;
}): Promise<LabTelegramSession> {
  const stringSession = new sessions.StringSession(input.session);
  const logger = new RedactingLabLogger(input.secrets, input.logSink, input.logLevel ?? LogLevel.WARN);
  const client = new TelegramClient(stringSession, input.credentials.apiId, input.credentials.apiHash, {
    ...LAB_CLIENT_OPTIONS,
    baseLogger: logger,
  });
  const rpc = instrumentInvoke(client as unknown as { invoke: InvokeLike });
  await client.connect();
  return {
    client,
    invokeLab: rpc.invokeLab,
    traffic: rpc.traffic,
    saveSession: () => stringSession.save(),
    close: async () => {
      await client.destroy().catch(() => undefined);
    },
  };
}
