import { runLiveCommand, type TelegramSessionHandle } from "./live.js";
import type { AdvisorySessionLock } from "./lock.js";
import { encryptLabSession } from "./session-crypto.js";
import { directSessionGuard, MemoryLabStore } from "./store.js";
import { FakeLock } from "./testing/fakes.js";
import { labReaders } from "./types.js";

const KEY = "c".repeat(64);
const ENV = {
  LAB_DATABASE_URL: "postgresql://lab:local@127.0.0.1:55432/cpm_lab_ops",
  DATABASE_URL: "postgresql://lab:local@127.0.0.1:55432/cpm_lab_appguard",
  LAB_API_ID: "12345",
  LAB_API_HASH: "0123456789abcdef0123456789abcdef",
  LAB_SESSION_ENCRYPTION_KEY: KEY,
  LAB_CHANNEL_ID: "-1001234567890",
  LAB_POST_ID: "42",
  LAB_CHANNEL_USERNAME: "octolab_test",
};

const store = new MemoryLabStore();
for (const reader of labReaders) {
  await store.saveSession(reader, encryptLabSession("session", KEY), false, directSessionGuard(() => true));
}
store.states.set("BOT_CHANNELS_GET_MESSAGES", {
  reader: "BOT_CHANNELS_GET_MESSAGES",
  nextAllowedAt: new Date(Date.now() + 30_000),
  stoppedAt: null,
  stopReason: null,
});

const lock = new FakeLock();
const code = await runLiveCommand("preflight", [], ENV, {
  openStore: async () => store,
  withLock: async (_url, run) => run(lock as unknown as AdvisorySessionLock, { backendPid: 1, sessionGuard: directSessionGuard(() => lock.isHeld(), 1) }),
  openTelegram: async () => {
    const handle: TelegramSessionHandle = {
      invokeLab: async () => {
        throw new Error("the harness stops before any request");
      },
      traffic: () => ({ countedAtInvoke: {}, notFullyMeasured: [] }),
      saveSession: () => "session",
      close: async () => undefined,
      loginClient: () => {
        throw new Error("not used");
      },
    };
    return handle;
  },
  out: (line) => process.stdout.write(`${line}\n`),
  err: (line) => process.stderr.write(`${line}\n`),
});
process.exit(code);
