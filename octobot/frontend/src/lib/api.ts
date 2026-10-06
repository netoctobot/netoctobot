export class ApiError extends Error {
  constructor(
    public code: string,
    public status: number,
  ) {
    super(code);
  }
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/admin-api${path}`, {
    ...init,
    credentials: "include",
    headers: {
      ...(init?.body ? { "content-type": "application/json" } : {}),
      ...init?.headers,
    },
  });
  const text = await response.text();
  const body = text ? (JSON.parse(text) as { error?: string }) : {};
  if (!response.ok) {
    throw new ApiError(body.error ?? "generic", response.status);
  }
  return body as T;
}

const ERROR_KEYS: Record<string, string> = {
  unauthorized: "errors.unauthorized",
  not_owner: "errors.notOwner",
  owner_not_registered: "errors.ownerNotRegistered",
  invalid_login: "errors.invalidLogin",
  invalid_reason: "errors.invalidReason",
  invalid_language: "errors.invalidLanguage",
  invalid_order: "errors.invalidOrder",
  not_found: "errors.notFound",
  platform_bot_missing: "errors.platformBotMissing",
};

export function errorKey(code: string): string {
  return ERROR_KEYS[code] ?? "errors.generic";
}

export function telegramLink(username: string | null): string | null {
  if (!username || !/^[A-Za-z0-9_]{4,}$/.test(username)) {
    return null;
  }
  return `https://t.me/${username}`;
}
