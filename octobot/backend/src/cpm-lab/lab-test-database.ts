import { randomBytes } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { isPostgresTarget, sameDatabaseTarget } from "./database-target.js";

/**
 * LAB_TEST_DATABASE_URL names a separate database used only for lab tests.
 * It must differ by host, port, or database name from LAB_DATABASE_URL and
 * DATABASE_URL. Each test applies the lab migrations inside a new schema
 * cpm_lab_test_<12 hex> and drops only that schema.
 */
export class LabTestDatabaseError extends Error {
  constructor(message: string) {
    super(`${message} The URL was not shown.`);
    this.name = "LabTestDatabaseError";
  }
}

const SCHEMA_PATTERN = /^cpm_lab_test_[0-9a-f]{12}$/;

export function assertIsolatedTestDatabase(env: Record<string, string | undefined>): string {
  const raw = env.LAB_TEST_DATABASE_URL?.trim();
  if (!raw) {
    throw new LabTestDatabaseError("LAB_TEST_DATABASE_URL is required for lab database tests.");
  }
  if (!isPostgresTarget(raw)) {
    throw new LabTestDatabaseError("LAB_TEST_DATABASE_URL must be a PostgreSQL URL with a host, port, and database name.");
  }
  for (const key of ["LAB_DATABASE_URL", "DATABASE_URL"] as const) {
    const other = env[key]?.trim();
    if (!other) continue;
    const same = sameDatabaseTarget(raw, other);
    if (same === null) {
      throw new LabTestDatabaseError(`${key} is set but could not be parsed, so the test database cannot be proven distinct.`);
    }
    if (same) {
      throw new LabTestDatabaseError(`LAB_TEST_DATABASE_URL uses the same host, port, and database as ${key}.`);
    }
  }
  return raw;
}

export function labMigrationsDir(moduleUrl: string | URL = import.meta.url): string {
  return fileURLToPath(new URL("../../prisma-lab/migrations", moduleUrl));
}

export function labMigrationFiles(dir = labMigrationsDir()): string[] {
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
    .map((name) => path.join(dir, name, "migration.sql"));
}

export function withSchema(databaseUrl: string, schema: string): string {
  const url = new URL(databaseUrl);
  url.searchParams.set("schema", schema);
  return url.toString();
}

export type TemporaryLabSchema = {
  schema: string;
  url: string;
  drop(): Promise<void>;
};

export async function createTemporaryLabSchema(testUrl: string): Promise<TemporaryLabSchema> {
  const schema = `cpm_lab_test_${randomBytes(6).toString("hex")}`;
  const client = new pg.Client({ connectionString: testUrl, application_name: "cpm-lab-test" });
  await client.connect();
  try {
    await client.query(`CREATE SCHEMA "${schema}"`);
    await client.query(`SET search_path TO "${schema}"`);
    for (const file of labMigrationFiles()) {
      await client.query(readFileSync(file, "utf8"));
    }
  } catch (error) {
    await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`).catch(() => undefined);
    await client.end().catch(() => undefined);
    throw error;
  }
  await client.end();
  return {
    schema,
    url: withSchema(testUrl, schema),
    drop: () => dropTemporaryLabSchema(testUrl, schema),
  };
}

export async function dropTemporaryLabSchema(testUrl: string, schema: string): Promise<void> {
  if (!SCHEMA_PATTERN.test(schema)) {
    throw new LabTestDatabaseError("Refusing to drop a schema that is not a lab test schema.");
  }
  const client = new pg.Client({ connectionString: testUrl, application_name: "cpm-lab-test" });
  await client.connect();
  try {
    await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
  } finally {
    await client.end().catch(() => undefined);
  }
}
