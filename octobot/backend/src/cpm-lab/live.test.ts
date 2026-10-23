import assert from "node:assert/strict";
import test from "node:test";
import { isLiveCommand, LOCKED_COMMANDS } from "./commands.js";
import { runLiveCommand, type LiveDeps, type TelegramSessionHandle } from "./live.js";
import type { AdvisorySessionLock } from "./lock.js";
import { encryptLabSession } from "./session-crypto.js";
import { MemoryLabStore } from "./store.js";
import { FakeClock, FakeLock } from "./testing/fakes.js";
import { mainCommand, startLab } from "./main.js";

const KEY = "b".repeat(64);
const ENV = {
  LAB_DATABASE_URL: "postgresql://lab:secret-lab-pass@lab-postgres:5432/cpm_lab",
  DATABASE_URL: "postgresql://postgres:5432/octobot",
  LAB_API_ID: "12345",
  LAB_API_HASH: "0123456789abcdef0123456789abcdef",
  LAB_SESSION_ENCRYPTION_KEY: KEY,
  LAB_CHANNEL_ID: "-1001234567890",
  LAB_POST_ID: "42",
  LAB_CHANNEL_USERNAME: "octolab_test",
  LAB_TRIAL_ROUNDS: "2",
  LAB_TRIAL_INTERVAL_SECONDS: "60",
};

function fakeDeps(store: MemoryLabStore, events: string[]): Partial<LiveDeps> {
  return {
    openStore: async () => store,
    withLock: async (_url, run) => {
      events.push("lock");
      try {
        return await run(new FakeLock() as unknown as AdvisorySessionLock);
      } finally {
        events.push("unlock");
      }
    },
    lockHolders: async () => 0,
    openTelegram: async () => {
      events.push("telegram");
      const handle: TelegramSessionHandle = {
        invokeLab: async (request) => {
          events.push(`rpc:${request.className}`);
          if (request.className === "contacts.ResolveUsername") {
            return { className: "contacts.ResolvedPeer", peer: { className: "PeerChannel", channelId: "1234567890" }, chats: [{ className: "Channel", id: "1234567890", accessHash: "9" }] };
          }
          if (request.className === "channels.GetChannels") {
            return { className: "messages.Chats", chats: [{ className: "Channel", id: "1234567890", accessHash: "8" }] };
          }
          if (request.className === "channels.GetMessages") {
            return { className: "messages.ChannelMessages", messages: [{ className: "Message", id: 42, peerId: { className: "PeerChannel", channelId: "1234567890" }, views: 2 }] };
          }
          return { className: "messages.MessageViews", views: [{ className: "MessageViews", views: 2 }] };
        },
        traffic: () => ({ countedAtInvoke: {}, notFullyMeasured: [] }),
        saveSession: () => "session",
        close: async () => void events.push("telegram-close"),
        loginClient: () => {
          throw new Error("not used");
        },
      };
      return handle;
    },
    clock: new FakeClock(),
    stopSignal: () => new AbortController().signal,
    out: () => undefined,
    err: () => undefined,
  };
}

test("run requires --confirm-live before any database or Telegram access", async () => {
  const events: string[] = [];
  let opened = false;
  await assert.rejects(
    runLiveCommand("run", [], ENV, { ...fakeDeps(new MemoryLabStore(), events), openStore: async () => ((opened = true), new MemoryLabStore()) }),
    /--confirm-live/,
  );
  assert.equal(opened, false);
  assert.deepEqual(events, []);
});

test("preflight takes the lock before opening Telegram and closes clients before unlocking", async () => {
  const store = new MemoryLabStore();
  for (const reader of ["BOT_CHANNELS_GET_MESSAGES", "USER_GET_MESSAGES_VIEWS"] as const) {
    await store.saveSession(reader, encryptLabSession("session", KEY), false);
  }
  const events: string[] = [];
  const code = await runLiveCommand("preflight", [], ENV, fakeDeps(store, events));
  assert.equal(code, 0);
  assert.equal(events[0], "lock");
  assert.equal(events.indexOf("telegram") > events.indexOf("lock"), true);
  assert.equal(events.lastIndexOf("telegram-close") < events.indexOf("unlock"), true);
  assert.equal(store.runs[0]?.kind, "PREFLIGHT");
});

test("a stopped reader's session is not opened", async () => {
  const store = new MemoryLabStore();
  for (const reader of ["BOT_CHANNELS_GET_MESSAGES", "USER_GET_MESSAGES_VIEWS"] as const) {
    await store.saveSession(reader, encryptLabSession("session", KEY), false);
  }
  await store.stopReader("USER_GET_MESSAGES_VIEWS", "SESSION_REVOKED", new Date());
  const events: string[] = [];
  await runLiveCommand("preflight", [], ENV, fakeDeps(store, events));
  assert.equal(events.filter((event) => event === "telegram").length, 1);
  assert.equal(events.some((event) => event === "rpc:messages.GetMessagesViews"), false);
});

test("login and clear-stop run under the lock; report, status, and mark-view do not", async () => {
  assert.deepEqual([...LOCKED_COMMANDS].sort(), ["clear-stop", "login-bot", "login-user", "preflight", "run"]);
  const store = new MemoryLabStore();
  const events: string[] = [];
  await runLiveCommand("clear-stop", ["--reader", "bot"], ENV, fakeDeps(store, events));
  assert.deepEqual(events, ["lock", "unlock"]);
  events.length = 0;
  await store.createRun({ label: "t", kind: "TRIAL", settings: {}, startedAt: new Date() });
  await runLiveCommand("mark-view", ["--note", "opened on phone"], ENV, fakeDeps(store, events));
  await runLiveCommand("report", [], ENV, fakeDeps(store, events));
  await runLiveCommand("status", [], ENV, fakeDeps(store, events));
  assert.deepEqual(events, []);
  assert.equal(store.manualEvents.length, 1);
});

test("lab commands reject the application database before opening a store", async () => {
  let opened = false;
  await assert.rejects(
    runLiveCommand("status", [], { ...ENV, LAB_DATABASE_URL: "postgresql://other:pw@postgres:5432/octobot" }, { openStore: async () => ((opened = true), new MemoryLabStore()) }),
    /same host, port, and database/,
  );
  assert.equal(opened, false);
});

test("fixture stays the default and live is not a command", async () => {
  assert.equal(isLiveCommand("live"), false);
  assert.throws(() => startLab("live"), /fixture mode only/);
  const writes: string[] = [];
  const original = process.stderr.write.bind(process.stderr);
  process.stderr.write = ((chunk: string) => (writes.push(String(chunk)), true)) as typeof process.stderr.write;
  try {
    assert.equal(await mainCommand(["live"], {}), 1);
  } finally {
    process.stderr.write = original;
  }
  assert.match(writes.join(""), /Unknown cpm-lab command/);
});
