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
  invalid_login: "errors.invalidLogin",
  invalid_reason: "errors.invalidReason",
  invalid_language: "errors.invalidLanguage",
  invalid_order: "errors.invalidOrder",
  not_found: "errors.notFound",
  catalog_unresolved: "errors.catalogUnresolved",
  catalog_not_channel: "errors.catalogNotChannel",
  catalog_unavailable: "errors.catalogUnavailable",
  catalog_not_admin: "errors.catalogNotAdmin",
  catalog_join_unavailable: "errors.catalogJoinUnavailable",
  invalid_broadcast: "errors.invalidBroadcast",
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
