const BOT_TOKEN = /\b\d{6,12}:[A-Za-z0-9_-]{20,}\b/g;
const LAB_ASSIGNMENT =
  /\b(LAB_SESSION_ENCRYPTION_KEY|LAB_API_HASH|LAB_BOT_TOKEN|LAB_API_ID|ENCRYPTION_KEY|BOT_TOKEN)\b(\s*[:=]\s*)("[^"]*"|'[^']*'|\S+)/gi;

export function redactSecrets(text: string, secrets: readonly string[]): string {
  let redacted = text;
  const unique = [...new Set(secrets)]
    .filter((secret) => secret.length >= 8)
    .sort((left, right) => right.length - left.length);
  for (const secret of unique) {
    redacted = redacted.split(secret).join("[redacted]");
  }
  return redacted.replace(BOT_TOKEN, "[redacted]").replace(LAB_ASSIGNMENT, "$1$2[redacted]");
}

export function errorText(error: unknown): string {
  if (error instanceof Error) {
    return `${error.name}: ${error.message}\n${error.stack ?? ""}`;
  }
  return String(error);
}

export function redactError(error: unknown, secrets: readonly string[]): string {
  return redactSecrets(errorText(error), secrets);
}

export type LabLogSink = (line: string) => void;

export function createRedactingLogger(
  secrets: readonly string[],
  sink: LabLogSink,
): {
  log: (message: string) => void;
  logError: (error: unknown) => void;
} {
  return {
    log(message: string) {
      sink(redactSecrets(message, secrets));
    },
    logError(error: unknown) {
      sink(redactError(error, secrets));
    },
  };
}
