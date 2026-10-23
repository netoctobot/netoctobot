import assert from "node:assert/strict";
import test from "node:test";
import { loginBot, loginUser, LabLoginError, type LoginClient, type LoginLock, type LoginPrompt, type UserSignInParams } from "./login.js";
import { decryptLabSession } from "./session-crypto.js";
import { LabLockLostError, MemoryLabStore, SessionExistsError } from "./store.js";

const KEY = "a".repeat(64);
const CREDENTIALS = { apiId: 12345, apiHash: "0123456789abcdef0123456789abcdef" };
const PHONE = "+9647700000000";
const CODE = "24680";
const PASSWORD = "two-step-secret";

class TestLock {
  held = true;
  probeResult: (() => boolean) | null = null;
  probes = 0;
  private readonly controller = new AbortController();
  readonly lock: LoginLock = {
    signal: this.controller.signal,
    probe: async () => {
      this.probes += 1;
      return this.probeResult ? this.probeResult() : this.held;
    },
    guard: { backendPid: 4242, isHeld: () => this.held },
  };
  lose() {
    this.held = false;
    this.controller.abort();
  }
}

const held = () => new TestLock().lock;

class FakePrompt implements LoginPrompt {
  readonly asked: string[] = [];
  closed = false;
  constructor(readonly interactive = true) {}
  async ask(label: string) {
    this.asked.push(`plain:${label}`);
    return PHONE;
  }
  async askHidden(label: string) {
    this.asked.push(`hidden:${label}`);
    return label.startsWith("Login code") ? CODE : PASSWORD;
  }
  close() {
    this.closed = true;
  }
}

class FakeClient implements LoginClient {
  userParams: UserSignInParams | null = null;
  botToken: string | null = null;
  closed = false;
  constructor(private readonly isBot: boolean, private readonly userFlow?: (params: UserSignInParams) => Promise<void>) {}
  async signInBot(_credentials: unknown, params: { botAuthToken: string }) {
    this.botToken = params.botAuthToken;
  }
  async signInUser(_credentials: unknown, params: UserSignInParams) {
    this.userParams = params;
    if (this.userFlow) {
      await this.userFlow(params);
      return;
    }
    await params.phoneNumber();
    await params.phoneCode();
    await params.password();
  }
  async getMe() {
    return { bot: this.isBot };
  }
  saveSession() {
    return "1BVtsOK8Bu0-session-string";
  }
  async close() {
    this.closed = true;
  }
}

test("login-user asks for the code and password hidden and stores only ciphertext", async () => {
  const store = new MemoryLabStore();
  const prompt = new FakePrompt();
  const client = new FakeClient(false);
  const lines: string[] = [];
  await loginUser({ store, credentials: CREDENTIALS, sessionKey: KEY, replace: false, lock: held(), prompt, openClient: async () => client, out: (line) => lines.push(line) });

  assert.deepEqual(
    prompt.asked.map((entry) => entry.split(":")[0]),
    ["plain", "hidden", "hidden"],
  );
  const stored = store.sessions.get("USER_GET_MESSAGES_VIEWS")!;
  assert.notEqual(stored.ciphertext, client.saveSession());
  assert.equal(decryptLabSession(stored.ciphertext, KEY), client.saveSession());
  const output = lines.join("\n");
  for (const secret of [PHONE, CODE, PASSWORD, client.saveSession()]) {
    assert.equal(output.includes(secret), false);
  }
  assert.equal(client.closed, true);
  assert.equal(prompt.closed, true);
});

test("login-user never offers sign up and declines the terms of service", async () => {
  const client = new FakeClient(false);
  await loginUser({ store: new MemoryLabStore(), credentials: CREDENTIALS, sessionKey: KEY, replace: false, lock: held(), prompt: new FakePrompt(), openClient: async () => client, out: () => undefined });
  assert.equal("firstAndLastNames" in (client.userParams ?? {}), false);
  assert.equal(await client.userParams?.acceptTermsOfService(), false);
  assert.equal(await client.userParams?.onError(new Error("PHONE_CODE_INVALID")), true);
});

test("login-user refuses without a TTY before opening a client", async () => {
  let opened = false;
  await assert.rejects(
    loginUser({ store: new MemoryLabStore(), credentials: CREDENTIALS, sessionKey: KEY, replace: false, lock: held(), prompt: new FakePrompt(false), openClient: async () => ((opened = true), new FakeClient(false)), out: () => undefined }),
    /interactive terminal/,
  );
  assert.equal(opened, false);
});

test("login failure text does not echo user input", async () => {
  const client = new FakeClient(false, async (params) => {
    const error = Object.assign(new Error(`bad code ${CODE} for ${PHONE}`), { errorMessage: "PHONE_CODE_INVALID" });
    await params.onError(error);
    throw new Error("AUTH_USER_CANCEL");
  });
  await assert.rejects(
    loginUser({ store: new MemoryLabStore(), credentials: CREDENTIALS, sessionKey: KEY, replace: false, lock: held(), prompt: new FakePrompt(), openClient: async () => client, out: () => undefined }),
    (error: Error) => error instanceof LabLoginError && /PHONE_CODE_INVALID/.test(error.message) && !error.message.includes(CODE) && !error.message.includes(PHONE),
  );
});

test("existing sessions need --replace, and the account kind must match the reader", async () => {
  const store = new MemoryLabStore();
  const base = { store, credentials: CREDENTIALS, sessionKey: KEY, lock: held(), out: () => undefined };
  await loginBot({ ...base, replace: false, botToken: "123456:token", openClient: async () => new FakeClient(true) });
  let opened = false;
  await assert.rejects(
    loginBot({ ...base, replace: false, botToken: "123456:token", openClient: async () => ((opened = true), new FakeClient(true)) }),
    SessionExistsError,
  );
  assert.equal(opened, false);
  await loginBot({ ...base, replace: true, botToken: "123456:token", openClient: async () => new FakeClient(true) });

  await assert.rejects(
    loginUser({ ...base, replace: false, prompt: new FakePrompt(), openClient: async () => new FakeClient(true) }),
    /is a bot/,
  );
  assert.equal(store.sessions.has("USER_GET_MESSAGES_VIEWS"), false);
  const fresh = new MemoryLabStore();
  await assert.rejects(
    loginBot({ ...base, store: fresh, replace: false, botToken: "123456:token", openClient: async () => new FakeClient(false) }),
    /not a bot/,
  );
  assert.equal(fresh.sessions.size, 0);
});

/** The login code question waits until the prompt is closed, which rejects it. */
class WaitingPrompt extends FakePrompt {
  waitingForCode: Promise<void>;
  private reachedCode!: () => void;
  private rejectPending: ((error: Error) => void) | null = null;
  constructor() {
    super();
    this.waitingForCode = new Promise((resolve) => (this.reachedCode = resolve));
  }
  override async askHidden(label: string) {
    if (!label.startsWith("Login code")) return super.askHidden(label);
    this.asked.push(`hidden:${label}`);
    return new Promise<string>((_resolve, reject) => {
      this.rejectPending = reject;
      this.reachedCode();
    });
  }
  override close() {
    super.close();
    this.rejectPending?.(new Error("PROMPT_CLOSED"));
  }
}

const OLD_SESSION = "old-ciphertext";

test("lock lost while waiting for the code: the prompt and client close and nothing is stored", async () => {
  const store = new MemoryLabStore();
  const prompt = new WaitingPrompt();
  const control = new TestLock();
  let afterCode = 0;
  const client = new FakeClient(false, async (params) => {
    await params.phoneNumber();
    await params.phoneCode();
    afterCode += 1;
    await params.password();
  });
  const login = loginUser({ store, credentials: CREDENTIALS, sessionKey: KEY, replace: false, lock: control.lock, prompt, openClient: async () => client, out: () => undefined });
  await prompt.waitingForCode;
  control.lose();
  await assert.rejects(login, LabLockLostError);
  assert.equal(prompt.closed, true);
  assert.equal(client.closed, true);
  assert.equal(afterCode, 0);
  assert.equal(prompt.asked.some((entry) => entry.includes("Two-step")), false);
  assert.equal(store.sessions.size, 0);
});

test("lock lost during a Telegram call: login rejects at once and a late result stores nothing", async () => {
  const store = new MemoryLabStore();
  store.sessions.set("BOT_CHANNELS_GET_MESSAGES", { ciphertext: OLD_SESSION, keyVersion: 1 });
  const control = new TestLock();
  let finishSignIn!: () => void;
  let getMeCalls = 0;
  const client = new FakeClient(true);
  client.signInBot = () => new Promise<void>((resolve) => (finishSignIn = resolve));
  const originalGetMe = client.getMe.bind(client);
  client.getMe = async () => ((getMeCalls += 1), originalGetMe());
  const login = loginBot({ store, credentials: CREDENTIALS, sessionKey: KEY, replace: true, lock: control.lock, botToken: "123456:token", openClient: async () => client, out: () => undefined });
  await new Promise((resolve) => setImmediate(resolve));
  control.lose();
  await assert.rejects(login, LabLockLostError);
  assert.equal(client.closed, true);
  finishSignIn();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(getMeCalls, 0);
  assert.equal(store.sessions.get("BOT_CHANNELS_GET_MESSAGES")?.ciphertext, OLD_SESSION);
});

test("lock lost just before the save: --replace keeps the old session", async () => {
  for (const where of ["probe", "guard"] as const) {
    const store = new MemoryLabStore();
    store.sessions.set("USER_GET_MESSAGES_VIEWS", { ciphertext: OLD_SESSION, keyVersion: 1 });
    const control = new TestLock();
    const client = new FakeClient(false);
    client.getMe = async () => {
      if (where === "probe") control.probeResult = () => false;
      else control.lock.guard.isHeld = () => false;
      return { bot: false };
    };
    await assert.rejects(
      loginUser({ store, credentials: CREDENTIALS, sessionKey: KEY, replace: true, lock: control.lock, prompt: new FakePrompt(), openClient: async () => client, out: () => undefined }),
      LabLockLostError,
      where,
    );
    assert.equal(store.sessions.get("USER_GET_MESSAGES_VIEWS")?.ciphertext, OLD_SESSION, where);
    assert.equal(client.closed, true, where);
  }
});

test("no client is opened when the lock is already gone", async () => {
  const control = new TestLock();
  control.probeResult = () => false;
  let opened = false;
  await assert.rejects(
    loginBot({ store: new MemoryLabStore(), credentials: CREDENTIALS, sessionKey: KEY, replace: true, lock: control.lock, botToken: "123456:token", openClient: async () => ((opened = true), new FakeClient(true)), out: () => undefined }),
    LabLockLostError,
  );
  assert.equal(opened, false);
});
