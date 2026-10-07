import { createHmac, timingSafeEqual } from "node:crypto";

export const ADMIN_SESSION_COOKIE = "octobot_admin_session";
const SESSION_SECONDS = 60 * 60 * 12;

export interface AdminSession {
  adminId: string;
  exp: number;
}

export function signAdminSession(
  session: AdminSession,
  secret: string,
): string {
  const body = Buffer.from(JSON.stringify(session)).toString("base64url");
  const signature = createHmac("sha256", secret).update(body).digest("base64url");
  return `${body}.${signature}`;
}

export function readAdminSession(
  token: string | undefined,
  secret: string,
  nowMs: number,
): AdminSession | null {
  if (!token) {
    return null;
  }
  const separator = token.indexOf(".");
  if (separator < 1) {
    return null;
  }
  const body = token.slice(0, separator);
  const signature = token.slice(separator + 1);
  const expected = createHmac("sha256", secret).update(body).digest("base64url");
  const actualBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  if (
    actualBuffer.length !== expectedBuffer.length ||
    !timingSafeEqual(actualBuffer, expectedBuffer)
  ) {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(
      Buffer.from(body, "base64url").toString("utf8"),
    );
    if (
      !parsed ||
      typeof parsed !== "object" ||
      !("adminId" in parsed) ||
      !("exp" in parsed)
    ) {
      return null;
    }
    const session = parsed as AdminSession;
    if (
      typeof session.adminId !== "string" ||
      session.adminId.length === 0 ||
      typeof session.exp !== "number" ||
      session.exp * 1000 <= nowMs
    ) {
      return null;
    }
    return session;
  } catch {
    return null;
  }
}

export function readCookie(
  header: string | undefined,
  name: string,
): string | undefined {
  if (!header) {
    return undefined;
  }
  for (const part of header.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 1) {
      continue;
    }
    if (part.slice(0, separator).trim() === name) {
      return decodeURIComponent(part.slice(separator + 1).trim());
    }
  }
  return undefined;
}

export function sessionCookieHeader(token: string, secure: boolean): string {
  return cookieHeader(token, secure, SESSION_SECONDS);
}

export function clearSessionCookieHeader(secure: boolean): string {
  return cookieHeader("", secure, 0);
}

function cookieHeader(token: string, secure: boolean, maxAge: number): string {
  const parts = [
    `${ADMIN_SESSION_COOKIE}=${encodeURIComponent(token)}`,
    "HttpOnly",
    "Path=/",
    "SameSite=Lax",
    `Max-Age=${maxAge}`,
  ];
  if (secure) {
    parts.push("Secure");
  }
  return parts.join("; ");
}

export function sessionExpiry(nowMs: number): number {
  return Math.floor(nowMs / 1000) + SESSION_SECONDS;
}
