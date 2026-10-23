/**
 * Lab commands require LAB_DATABASE_URL and never fall back to DATABASE_URL.
 * A target matches when the lowercase host, the port (5432 when omitted), and
 * the decoded database name are the same. User, password, query parameters,
 * and schema are ignored, so a different credential or schema still rejects
 * the application database.
 * This check does not detect different host aliases that point at the same server.
 * Errors do not include credentials or connection strings.
 * lab:generate may omit DATABASE_URL. lab:migrate sets requireAppDatabase and
 * rejects a missing, blank, or unparseable application URL before Prisma starts.
 */

export type LabDatabaseTargetCode =
  | "missing"
  | "invalid"
  | "same_database"
  | "missing_app_database"
  | "unparseable_app_database";

const ALIAS_LIMIT =
  "This check does not detect different host aliases that point at the same server.";

export class LabDatabaseTargetError extends Error {
  readonly code: LabDatabaseTargetCode;

  constructor(code: LabDatabaseTargetCode, message: string) {
    super(message);
    this.name = "LabDatabaseTargetError";
    this.code = code;
  }
}

type DatabaseTarget = {
  host: string;
  port: string;
  database: string;
};

export function assertDistinctLabDatabase(
  env: {
    LAB_DATABASE_URL?: string | undefined;
    DATABASE_URL?: string | undefined;
  },
  options?: { requireAppDatabase?: boolean },
): string {
  const labRaw = env.LAB_DATABASE_URL;
  if (labRaw === undefined || labRaw.trim() === "") {
    throw new LabDatabaseTargetError(
      "missing",
      `LAB_DATABASE_URL is required. DATABASE_URL is not used as a fallback. ${ALIAS_LIMIT}`,
    );
  }

  const labUrl = labRaw.trim();
  const labTarget = parsePostgresTarget(labUrl);
  if (!labTarget) {
    throw new LabDatabaseTargetError(
      "invalid",
      `LAB_DATABASE_URL must be a PostgreSQL URL with a host, port, and database name. ${ALIAS_LIMIT}`,
    );
  }

  const appRaw = env.DATABASE_URL;
  if (
    options?.requireAppDatabase &&
    (appRaw === undefined || appRaw.trim() === "")
  ) {
    throw new LabDatabaseTargetError(
      "missing_app_database",
      `DATABASE_URL is required for lab:migrate so the application database can be identified. It is not used as the lab connection. ${ALIAS_LIMIT}`,
    );
  }
  if (appRaw !== undefined && appRaw.trim() !== "") {
    const appTarget = parsePostgresTarget(appRaw.trim());
    if (!appTarget) {
      throw new LabDatabaseTargetError(
        "unparseable_app_database",
        `DATABASE_URL is set but could not be parsed, so the lab database cannot be proven distinct. ${ALIAS_LIMIT}`,
      );
    }
    if (sameDatabase(labTarget, appTarget)) {
      throw new LabDatabaseTargetError(
        "same_database",
        `LAB_DATABASE_URL uses the same host, port, and database as DATABASE_URL. Credentials, query parameters, and schema do not make it a different database. ${ALIAS_LIMIT}`,
      );
    }
  }

  return labUrl;
}

export function sameDatabaseTarget(left: string, right: string): boolean | null {
  const leftTarget = parsePostgresTarget(left.trim());
  const rightTarget = parsePostgresTarget(right.trim());
  if (!leftTarget || !rightTarget) {
    return null;
  }
  return sameDatabase(leftTarget, rightTarget);
}

export function isPostgresTarget(value: string): boolean {
  return parsePostgresTarget(value.trim()) !== null;
}

function sameDatabase(left: DatabaseTarget, right: DatabaseTarget): boolean {
  return (
    left.host === right.host &&
    left.port === right.port &&
    left.database === right.database
  );
}

function parsePostgresTarget(value: string): DatabaseTarget | null {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") {
    return null;
  }
  if (url.hostname === "") {
    return null;
  }
  const database = databaseName(url.pathname);
  if (database === null) {
    return null;
  }
  return {
    host: url.hostname.toLowerCase(),
    port: url.port === "" ? "5432" : url.port,
    database,
  };
}

function databaseName(pathname: string): string | null {
  const trimmed = pathname.replace(/^\/+|\/+$/g, "");
  if (trimmed === "" || trimmed.includes("/")) {
    return null;
  }
  try {
    const decoded = decodeURIComponent(trimmed);
    return decoded === "" ? null : decoded;
  } catch {
    return null;
  }
}
