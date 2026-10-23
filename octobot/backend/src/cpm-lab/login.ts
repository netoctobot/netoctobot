import type { TelegramCredentials } from "./config.js";
import { encryptLabSession } from "./session-crypto.js";
import { LabLockLostError, SessionExistsError, type LabStore, type SessionWriteGuard } from "./store.js";
import type { LabReader } from "./types.js";

export type LoginPrompt = {
  readonly interactive: boolean;
  ask(label: string): Promise<string>;
  askHidden(label: string): Promise<string>;
  /** Also rejects a question that is still waiting for an answer. */
  close(): void;
};

export type UserSignInParams = {
  phoneNumber: () => Promise<string>;
  phoneCode: () => Promise<string>;
  password: () => Promise<string>;
  acceptTermsOfService: () => Promise<boolean>;
  onError: (error: Error) => Promise<boolean>;
};

/** The subset of teleproto TelegramClient used for login. */
export type LoginClient = {
  signInBot(credentials: TelegramCredentials, params: { botAuthToken: string }): Promise<unknown>;
  signInUser(credentials: TelegramCredentials, params: UserSignInParams): Promise<unknown>;
  getMe(): Promise<{ bot?: boolean | undefined }>;
  saveSession(): string;
  close(): Promise<void>;
};

/**
 * signal aborts when the advisory lock is lost. probe asks PostgreSQL whether
 * the lock connection still holds it. guard is checked inside the session write.
 */
export type LoginLock = {
  signal: AbortSignal;
  probe: () => Promise<boolean>;
  guard: SessionWriteGuard;
};

export class LabLoginError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LabLoginError";
  }
}

type LoginDeps = {
  store: LabStore;
  credentials: TelegramCredentials;
  sessionKey: string;
  replace: boolean;
  lock: LoginLock;
  openClient: () => Promise<LoginClient>;
  out: (line: string) => void;
};

/**
 * Existing sessions are kept unless --replace is given. Neither command calls
 * auth.logOut. The bot token, phone, code, and password are never written to
 * any output or stored. If the lock is lost, the prompt and the client are
 * closed at once, the flow rejects with LabLockLostError, and no session is
 * written, even when a Telegram result arrives later.
 */
export async function loginBot(deps: LoginDeps & { botToken: string }): Promise<void> {
  const reader = "BOT_CHANNELS_GET_MESSAGES";
  await refuseExisting(deps, reader);
  await withLoginClient(deps, null, async (client) => {
    await untilLockLost(client.signInBot(deps.credentials, { botAuthToken: deps.botToken }), deps.lock.signal);
    await storeVerifiedSession(client, deps, reader);
  });
  deps.out("Bot session stored for BOT_CHANNELS_GET_MESSAGES. LAB_BOT_TOKEN can now be removed from backend/.env.lab.");
}

/**
 * Requires a TTY. No firstAndLastNames callback is passed, so teleproto
 * refuses to create an account (client/auth.js). Terms of service are
 * declined, and the first error stops the flow instead of asking again.
 */
export async function loginUser(deps: LoginDeps & { prompt: LoginPrompt }): Promise<void> {
  if (!deps.prompt.interactive) {
    throw new LabLoginError("login-user needs an interactive terminal. Run it with docker compose run -it.");
  }
  const reader = "USER_GET_MESSAGES_VIEWS";
  const { signal } = deps.lock;
  try {
    await refuseExisting(deps, reader);
    const answer = (ask: () => Promise<string>) => async () => {
      assertNotLost(signal);
      const value = await ask();
      assertNotLost(signal);
      return value;
    };
    await withLoginClient(deps, deps.prompt, async (client) => {
      let failure: Error | null = null;
      try {
        await untilLockLost(
          client.signInUser(deps.credentials, {
            phoneNumber: answer(() => deps.prompt.ask("Phone number of the lab account (international format): ")),
            phoneCode: answer(() => deps.prompt.askHidden("Login code (hidden): ")),
            password: answer(() => deps.prompt.askHidden("Two-step verification password (hidden): ")),
            acceptTermsOfService: async () => false,
            onError: async (error) => {
              failure = error;
              return true;
            },
          }),
          signal,
        );
      } catch (error) {
        if (signal.aborted || error instanceof LabLockLostError) {
          throw new LabLockLostError();
        }
        throw new LabLoginError(loginFailureText(failure ?? error));
      }
      await storeVerifiedSession(client, deps, reader);
    });
  } finally {
    deps.prompt.close();
  }
  deps.out("User session stored for USER_GET_MESSAGES_VIEWS.");
}

async function withLoginClient(
  deps: LoginDeps,
  prompt: LoginPrompt | null,
  run: (client: LoginClient) => Promise<void>,
): Promise<void> {
  await assertLockHeld(deps.lock);
  const client = await deps.openClient();
  let closing: Promise<void> | null = null;
  const closeClient = () => (closing ??= client.close().catch(() => undefined));
  const onLost = () => {
    prompt?.close();
    void closeClient();
  };
  deps.lock.signal.addEventListener("abort", onLost, { once: true });
  try {
    assertNotLost(deps.lock.signal);
    await run(client);
  } finally {
    deps.lock.signal.removeEventListener("abort", onLost);
    await closeClient();
  }
}

async function refuseExisting(deps: LoginDeps, reader: LabReader): Promise<void> {
  await assertLockHeld(deps.lock);
  if (!deps.replace && (await deps.store.loadSession(reader)) !== null) {
    throw new SessionExistsError();
  }
}

async function storeVerifiedSession(client: LoginClient, deps: LoginDeps, reader: LabReader): Promise<void> {
  const me = await untilLockLost(client.getMe(), deps.lock.signal);
  const isBot = me.bot === true;
  if (reader === "BOT_CHANNELS_GET_MESSAGES" && !isBot) {
    throw new LabLoginError("The signed-in account is not a bot. Nothing was stored.");
  }
  if (reader === "USER_GET_MESSAGES_VIEWS" && isBot) {
    throw new LabLoginError("The signed-in account is a bot. Nothing was stored.");
  }
  const session = client.saveSession();
  if (session === "") {
    throw new LabLoginError("teleproto returned an empty session. Nothing was stored.");
  }
  const ciphertext = encryptLabSession(session, deps.sessionKey);
  await assertLockHeld(deps.lock);
  await deps.store.saveSession(reader, ciphertext, deps.replace, deps.lock.guard);
}

async function assertLockHeld(lock: LoginLock): Promise<void> {
  assertNotLost(lock.signal);
  let held = false;
  try {
    held = await lock.probe();
  } catch {
    held = false;
  }
  if (!held || lock.signal.aborted || !lock.guard.isHeld()) {
    throw new LabLockLostError();
  }
}

function assertNotLost(signal: AbortSignal): void {
  if (signal.aborted) {
    throw new LabLockLostError();
  }
}

/** Settles with the first of the call or the lock loss. A late call result is dropped. */
function untilLockLost<T>(call: Promise<T>, signal: AbortSignal): Promise<T> {
  call.catch(() => undefined);
  if (signal.aborted) {
    return Promise.reject(new LabLockLostError());
  }
  return new Promise<T>((resolve, reject) => {
    const onLost = () => reject(new LabLockLostError());
    signal.addEventListener("abort", onLost, { once: true });
    call.then(
      (value) => {
        signal.removeEventListener("abort", onLost);
        if (signal.aborted) reject(new LabLockLostError());
        else resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener("abort", onLost);
        reject(signal.aborted ? new LabLockLostError() : error);
      },
    );
  });
}

/** Only the error name or Telegram error code. The message can echo user input. */
function loginFailureText(error: unknown): string {
  if (error && typeof error === "object") {
    const record = error as Record<string, unknown>;
    if (typeof record.errorMessage === "string" && /^[A-Z0-9_]+$/.test(record.errorMessage)) {
      return `Login stopped: ${record.errorMessage}. Nothing was stored.`;
    }
    if (record.message === "AUTH_USER_CANCEL") {
      return "Login stopped. Nothing was stored.";
    }
    if (typeof record.message === "string" && record.message.startsWith("No account is registered")) {
      return "Login stopped: no account is registered with this number, and the lab does not sign up. Nothing was stored.";
    }
  }
  return "Login stopped. Nothing was stored.";
}
