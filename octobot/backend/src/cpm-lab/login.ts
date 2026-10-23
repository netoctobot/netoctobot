import type { TelegramCredentials } from "./config.js";
import { encryptLabSession } from "./session-crypto.js";
import { SessionExistsError, type LabStore } from "./store.js";
import type { LabReader } from "./types.js";

export type LoginPrompt = {
  readonly interactive: boolean;
  ask(label: string): Promise<string>;
  askHidden(label: string): Promise<string>;
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
  openClient: () => Promise<LoginClient>;
  out: (line: string) => void;
};

/**
 * Existing sessions are kept unless --replace is given. Neither command calls
 * auth.logOut. The bot token, phone, code, and password are never written to
 * any output or stored.
 */
export async function loginBot(deps: LoginDeps & { botToken: string }): Promise<void> {
  await refuseExisting(deps.store, "BOT_CHANNELS_GET_MESSAGES", deps.replace);
  const client = await deps.openClient();
  try {
    await client.signInBot(deps.credentials, { botAuthToken: deps.botToken });
    await storeVerifiedSession(client, deps, "BOT_CHANNELS_GET_MESSAGES");
  } finally {
    await client.close();
  }
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
  await refuseExisting(deps.store, "USER_GET_MESSAGES_VIEWS", deps.replace);
  let failure: Error | null = null;
  const client = await deps.openClient();
  try {
    try {
      await client.signInUser(deps.credentials, {
        phoneNumber: () => deps.prompt.ask("Phone number of the lab account (international format): "),
        phoneCode: () => deps.prompt.askHidden("Login code (hidden): "),
        password: () => deps.prompt.askHidden("Two-step verification password (hidden): "),
        acceptTermsOfService: async () => false,
        onError: async (error) => {
          failure = error;
          return true;
        },
      });
    } catch (error) {
      throw new LabLoginError(loginFailureText(failure ?? error));
    }
    await storeVerifiedSession(client, deps, "USER_GET_MESSAGES_VIEWS");
  } finally {
    await client.close();
    deps.prompt.close();
  }
  deps.out("User session stored for USER_GET_MESSAGES_VIEWS.");
}

async function refuseExisting(store: LabStore, reader: LabReader, replace: boolean): Promise<void> {
  if (!replace && (await store.loadSession(reader)) !== null) {
    throw new SessionExistsError();
  }
}

async function storeVerifiedSession(client: LoginClient, deps: LoginDeps, reader: LabReader): Promise<void> {
  const me = await client.getMe();
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
  await deps.store.saveSession(reader, encryptLabSession(session, deps.sessionKey), deps.replace);
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
