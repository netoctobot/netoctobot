import { LogLevel } from "teleproto/extensions/Logger.js";
import { LOCKED_COMMANDS, type LiveCommand } from "./commands.js";
import {
  botToken,
  channelConfig,
  labDatabaseUrl,
  labSecrets,
  sessionKey,
  telegramCredentials,
  trialConfig,
  type LabEnv,
  type TelegramCredentials,
} from "./config.js";
import { labLockHolders, withLabLock, type AdvisorySessionLock, type LabLockInfo } from "./lock.js";
import { loginBot, loginUser, type LoginClient, type LoginLock, type LoginPrompt } from "./login.js";
import { openPrismaLabStore } from "./prisma-store.js";
import { createTtyPrompt } from "./prompt.js";
import { BotChannelReader, UserViewsReader, type LabRpc, type ReaderTransport } from "./readers.js";
import { redactSecrets } from "./redact.js";
import { buildLabReport } from "./report.js";
import { decryptLabSession } from "./session-crypto.js";
import type { LabStore } from "./store.js";
import { runTestDatabaseCheck } from "./lab-test-database-check.js";
import type { LibraryTraffic } from "./telegram-client.js";
import { labReaders, type LabReader } from "./types.js";
import { runLabWorker, systemClock, type LabClock } from "./worker.js";

export type TelegramSessionHandle = LabRpc & {
  traffic(): LibraryTraffic;
  saveSession(): string;
  close(): Promise<void>;
  loginClient(): LoginClient;
};

export type LiveDeps = {
  openStore: (databaseUrl: string) => Promise<LabStore>;
  withLock: <T>(databaseUrl: string, run: (lock: AdvisorySessionLock, info: LabLockInfo) => Promise<T>) => Promise<T>;
  /** How often login re-checks the lock in PostgreSQL while it waits. */
  loginProbeIntervalMs: number;
  lockHolders: (databaseUrl: string) => Promise<number>;
  openTelegram: (input: {
    credentials: TelegramCredentials;
    session: string;
    secrets: readonly string[];
    logSink: (line: string) => void;
    logLevel: LogLevel;
  }) => Promise<TelegramSessionHandle>;
  prompt: () => LoginPrompt;
  clock: LabClock;
  stopSignal: () => AbortSignal;
  testDatabase: (env: LabEnv, out: (line: string) => void) => Promise<number>;
  out: (line: string) => void;
  err: (line: string) => void;
};

export class LabUsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LabUsageError";
  }
}

export async function runLiveCommand(
  command: LiveCommand,
  args: readonly string[],
  env: LabEnv,
  overrides: Partial<LiveDeps> = {},
): Promise<number> {
  const deps: LiveDeps = { ...defaultDeps(), ...overrides };
  const secrets = labSecrets(env);
  const log = (line: string) => deps.err(redactSecrets(line, secrets));

  if (command === "test-db") {
    return deps.testDatabase(env, deps.out);
  }
  if (command === "run" && !args.includes("--confirm-live")) {
    throw new LabUsageError("run sends live Telegram requests. Pass --confirm-live after the preflight review.");
  }
  const reader = command === "clear-stop" ? readerArgument(args) : null;
  const databaseUrl = labDatabaseUrl(env);
  const store = await deps.openStore(databaseUrl);
  try {
    if (!LOCKED_COMMANDS.includes(command)) {
      return await unlockedCommand(command, args, store, databaseUrl, deps);
    }
    return await deps.withLock(databaseUrl, async (lock, info) => {
      switch (command) {
        case "clear-stop": {
          const state = await store.clearReaderStop(reader as LabReader);
          deps.out(JSON.stringify({ cleared: state.reader, nextAllowedAt: state.nextAllowedAt?.toISOString() ?? null }));
          return 0;
        }
        case "login-bot":
        case "login-user":
          return await login(command, args, env, store, deps, secrets, log, lock, info);
        default:
          return await liveRun(command === "run" ? "TRIAL" : "PREFLIGHT", env, store, lock, deps, secrets, log);
      }
    });
  } finally {
    await store.close().catch(() => undefined);
  }
}

async function unlockedCommand(
  command: LiveCommand,
  args: readonly string[],
  store: LabStore,
  databaseUrl: string,
  deps: LiveDeps,
): Promise<number> {
  if (command === "status") {
    const [states, runs, started, holders] = await Promise.all([
      store.readerStates(),
      store.listRuns(5),
      store.countStarted(),
      deps.lockHolders(databaseUrl),
    ]);
    deps.out(
      JSON.stringify(
        {
          lockHeld: holders > 0,
          startedRequests: started,
          readerStates: states,
          sessions: Object.fromEntries(
            await Promise.all(labReaders.map(async (reader) => [reader, (await store.loadSession(reader)) !== null])),
          ),
          recentRuns: runs.map((run) => ({
            id: run.id,
            kind: run.kind,
            status: run.status,
            stopReason: run.stopReason,
            startedAt: run.startedAt,
            stoppedAt: run.stoppedAt,
          })),
        },
        null,
        2,
      ),
    );
    return 0;
  }
  if (command === "report") {
    const runId = optionValue(args, "--run");
    const trial = await store.loadRunReport(runId, "TRIAL");
    const preflight = await store.loadRunReport(null, "PREFLIGHT");
    const report = buildLabReport({ trial, preflight, readerStates: await store.readerStates() });
    deps.out(JSON.stringify(report, null, 2));
    return 0;
  }
  if (command === "mark-view") {
    const atRaw = optionValue(args, "--at");
    const occurredAt = atRaw ? new Date(atRaw) : deps.clock.now();
    if (Number.isNaN(occurredAt.getTime())) {
      throw new LabUsageError("--at must be an ISO 8601 time, for example 2026-10-24T09:30:00+03:00.");
    }
    const note = optionValue(args, "--note");
    if (note !== null && note.length > 200) {
      throw new LabUsageError("--note must be at most 200 characters.");
    }
    const event = await store.addManualEvent({
      runId: optionValue(args, "--run"),
      kind: "VIEW_OPENED",
      occurredAt,
      note,
    });
    deps.out(JSON.stringify({ recorded: "VIEW_OPENED", runId: event.runId, occurredAt: occurredAt.toISOString() }));
    return 0;
  }
  throw new LabUsageError(`Unknown lab command ${command}.`);
}

async function login(
  command: "login-bot" | "login-user",
  args: readonly string[],
  env: LabEnv,
  store: LabStore,
  deps: LiveDeps,
  secrets: string[],
  log: (line: string) => void,
  lock: AdvisorySessionLock,
  info: LabLockInfo,
): Promise<number> {
  const credentials = telegramCredentials(env);
  const key = sessionKey(env);
  const replace = args.includes("--replace");
  const token = command === "login-bot" ? botToken(env) : null;
  const allSecrets = token ? [...secrets, token] : secrets;
  const openClient = async () =>
    (
      await deps.openTelegram({
        credentials,
        session: "",
        secrets: allSecrets,
        logSink: log,
        logLevel: LogLevel.WARN,
      })
    ).loginClient();
  const lost = new AbortController();
  lock.onLost(() => lost.abort());
  if (!lock.isHeld()) lost.abort();
  const heartbeat = setInterval(() => {
    void lock.probe().catch(() => false);
  }, deps.loginProbeIntervalMs);
  heartbeat.unref?.();
  const loginLock: LoginLock = {
    signal: lost.signal,
    probe: () => lock.probe(),
    guard: {
      backendPid: info.backendPid,
      isHeld: () => info.sessionGuard.isHeld() && !lost.signal.aborted,
      inLockTransaction: (write) => info.sessionGuard.inLockTransaction(write),
    },
  };
  const shared = { store, credentials, sessionKey: key, replace, lock: loginLock, openClient, out: deps.out };
  try {
    if (token !== null) {
      await loginBot({ ...shared, botToken: token });
    } else {
      await loginUser({ ...shared, prompt: deps.prompt() });
    }
  } finally {
    clearInterval(heartbeat);
  }
  return 0;
}

async function liveRun(
  kind: "PREFLIGHT" | "TRIAL",
  env: LabEnv,
  store: LabStore,
  lock: AdvisorySessionLock,
  deps: LiveDeps,
  secrets: string[],
  log: (line: string) => void,
): Promise<number> {
  const credentials = telegramCredentials(env);
  const key = sessionKey(env);
  const channel = channelConfig(env);
  const trial = trialConfig(env);
  const ciphertexts = new Map<LabReader, string>();
  const readers: LabReader[] = [];
  const abandoned = await store.abandonInterrupted(deps.clock.now());
  for (const reader of abandoned.stoppedReaders) {
    log(`${reader} stopped: a request from an interrupted run has no stored result. Review it, then run clear-stop.`);
  }
  for (const reader of labReaders) {
    const state = await store.readerState(reader);
    if (state.stoppedAt !== null) {
      log(`${reader} is stopped (${state.stopReason ?? "no reason"}). Its session is not opened. Use clear-stop after review.`);
      continue;
    }
    readers.push(reader);
  }
  if (readers.length === 0) {
    throw new LabUsageError("Both lab readers are stopped. Nothing was sent.");
  }
  if (readers.includes("USER_GET_MESSAGES_VIEWS") && channel.username === null && channel.inviteHash === null) {
    throw new LabUsageError("Set LAB_CHANNEL_USERNAME or LAB_CHANNEL_INVITE_LINK so the user session can resolve the channel.");
  }
  for (const reader of readers) {
    const stored = await store.loadSession(reader);
    if (!stored) {
      throw new LabUsageError(`No lab session for ${reader}. Run ${reader === "BOT_CHANNELS_GET_MESSAGES" ? "login-bot" : "login-user"} first.`);
    }
    ciphertexts.set(reader, stored.ciphertext);
  }

  const sessions = new Map<LabReader, TelegramSessionHandle>();
  try {
    for (const reader of readers) {
      const session = decryptLabSession(ciphertexts.get(reader) ?? "", key);
      sessions.set(
        reader,
        await deps.openTelegram({
          credentials,
          session,
          secrets: [...secrets, session],
          logSink: log,
          logLevel: LogLevel.WARN,
        }),
      );
    }
    const transports: ReaderTransport[] = [];
    const bot = sessions.get("BOT_CHANNELS_GET_MESSAGES");
    if (bot) transports.push(new BotChannelReader(bot, channel));
    const user = sessions.get("USER_GET_MESSAGES_VIEWS");
    if (user) transports.push(new UserViewsReader(user, channel));
    const summary = await runLabWorker({
      store,
      lock,
      clock: deps.clock,
      transports,
      channel,
      trial,
      kind,
      stopSignal: deps.stopSignal(),
      settings: { teleproto: "1.230.1" },
      libraryTraffic: () =>
        Object.fromEntries([...sessions.entries()].map(([reader, handle]) => [reader, handle.traffic()])),
      log,
      abandoned,
    });
    deps.out(JSON.stringify(summary));
    return ["completed", "signal"].includes(summary.stopReason) ? 0 : 2;
  } finally {
    for (const handle of sessions.values()) {
      await handle.close().catch(() => undefined);
    }
  }
}

function readerArgument(args: readonly string[]): LabReader {
  const value = optionValue(args, "--reader");
  if (value === "bot") return "BOT_CHANNELS_GET_MESSAGES";
  if (value === "user") return "USER_GET_MESSAGES_VIEWS";
  throw new LabUsageError("clear-stop needs --reader bot or --reader user.");
}

function optionValue(args: readonly string[], name: string): string | null {
  const index = args.indexOf(name);
  if (index === -1) return null;
  const value = args[index + 1];
  if (value === undefined || value.startsWith("--")) {
    throw new LabUsageError(`${name} needs a value.`);
  }
  return value;
}

function defaultDeps(): LiveDeps {
  const stop = new AbortController();
  return {
    openStore: openPrismaLabStore,
    withLock: withLabLock,
    loginProbeIntervalMs: 5_000,
    lockHolders: labLockHolders,
    openTelegram: async (input) => {
      const { openLabTelegramClient } = await import("./telegram-client.js");
      const session = await openLabTelegramClient(input);
      return {
        invokeLab: session.invokeLab,
        traffic: session.traffic,
        saveSession: session.saveSession,
        close: session.close,
        loginClient: () => ({
          signInBot: (credentials, params) => session.client.signInBot(credentials, params),
          signInUser: (credentials, params) => session.client.signInUser(credentials, params),
          getMe: async () => {
            const me = await session.client.getMe();
            return { bot: (me as { bot?: boolean }).bot };
          },
          saveSession: session.saveSession,
          close: session.close,
        }),
      };
    },
    prompt: () => createTtyPrompt(),
    clock: systemClock,
    stopSignal: () => {
      const onSignal = () => stop.abort();
      process.once("SIGTERM", onSignal);
      process.once("SIGINT", onSignal);
      return stop.signal;
    },
    testDatabase: runTestDatabaseCheck,
    out: (line) => process.stdout.write(`${line}\n`),
    err: (line) => process.stderr.write(`${line}\n`),
  };
}
