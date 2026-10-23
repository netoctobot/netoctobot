import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseEnv } from "node:util";
import {
  assertDistinctLabDatabase,
  LabDatabaseTargetError,
} from "./database-target.js";

/**
 * Lab commands read backend/.env from this module's package path, not from
 * process.cwd(). A variable already present in the environment wins over the
 * file, including when its value is empty. Only DATABASE_URL and
 * LAB_DATABASE_URL are taken from the file. The file is neither modified nor
 * printed. Prisma receives those merged values explicitly, and the lab schema
 * path is absolute, so a later .env load cannot replace the checked targets
 * and a relative --schema does not depend on the working directory.
 * lab:migrate requires a parseable DATABASE_URL. lab:generate does not.
 * LAB_DATABASE_URL stays required and is never copied from DATABASE_URL.
 */

const ENV_READ_ERROR =
  "The lab environment file could not be read. Its contents were not shown.";

export class LabEnvironmentFileError extends Error {
  constructor() {
    super(ENV_READ_ERROR);
    this.name = "LabEnvironmentFileError";
  }
}

export type LabCliAction = "generate" | "migrate";

export type PrismaRunRequest = {
  args: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
};

export type PrismaRunResult = {
  status: number | null;
  error?: boolean;
};

export function labBackendRoot(moduleUrl: string | URL = import.meta.url): string {
  const root = fileURLToPath(new URL("../..", moduleUrl));
  return root.endsWith(path.sep) ? root.slice(0, -1) : root;
}

export function labEnvFilePath(moduleUrl: string | URL = import.meta.url): string {
  return fileURLToPath(new URL("../../.env", moduleUrl));
}

export function labSchemaPath(moduleUrl: string | URL = import.meta.url): string {
  return fileURLToPath(new URL("../../prisma-lab/schema.prisma", moduleUrl));
}

export function readLabEnvFile(envFilePath: string): Record<string, string> {
  let content: string;
  try {
    content = readFileSync(envFilePath, "utf8");
  } catch (error) {
    if (isMissingFile(error)) {
      return {};
    }
    throw new LabEnvironmentFileError();
  }
  try {
    const parsed = parseEnv(content);
    const values: Record<string, string> = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (value !== undefined) {
        values[key] = value;
      }
    }
    return values;
  } catch {
    throw new LabEnvironmentFileError();
  }
}

export function mergeLabEnv(
  env: NodeJS.ProcessEnv,
  fileValues: Record<string, string>,
): { LAB_DATABASE_URL?: string; DATABASE_URL?: string } {
  return {
    LAB_DATABASE_URL: pickDefined(env.LAB_DATABASE_URL, fileValues.LAB_DATABASE_URL),
    DATABASE_URL: pickDefined(env.DATABASE_URL, fileValues.DATABASE_URL),
  };
}

export function runLabPrismaCli(options: {
  action: string | undefined;
  env: NodeJS.ProcessEnv;
  envFilePath: string;
  backendRoot: string;
  schemaPath: string;
  runPrisma: (request: PrismaRunRequest) => PrismaRunResult;
  stderr?: { write(chunk: string): void };
}): number {
  const stderr = options.stderr ?? process.stderr;
  if (options.action !== "generate" && options.action !== "migrate") {
    stderr.write("usage: prisma-cli.ts generate|migrate\n");
    return 1;
  }

  let merged: { LAB_DATABASE_URL?: string; DATABASE_URL?: string };
  try {
    merged = mergeLabEnv(options.env, readLabEnvFile(options.envFilePath));
  } catch (error) {
    stderr.write(`${errorMessage(error)}\n`);
    return 1;
  }

  let labUrl: string;
  try {
    labUrl = assertDistinctLabDatabase(merged, {
      requireAppDatabase: options.action === "migrate",
    });
  } catch (error) {
    stderr.write(`${errorMessage(error)}\n`);
    return 1;
  }

  const childEnv: NodeJS.ProcessEnv = { ...options.env };
  childEnv.LAB_DATABASE_URL = labUrl;
  if (merged.DATABASE_URL === undefined) {
    delete childEnv.DATABASE_URL;
  } else {
    childEnv.DATABASE_URL = merged.DATABASE_URL;
  }

  const prismaArgs =
    options.action === "generate"
      ? ["generate", "--schema", options.schemaPath]
      : ["migrate", "deploy", "--schema", options.schemaPath];
  const result = options.runPrisma({
    args: ["exec", "prisma", ...prismaArgs],
    cwd: options.backendRoot,
    env: childEnv,
  });
  if (result.error) {
    stderr.write("The lab Prisma command could not be started.\n");
    return 1;
  }
  return result.status ?? 1;
}

export function defaultPrismaRunner(request: PrismaRunRequest): PrismaRunResult {
  const child = spawnSync("pnpm", request.args, {
    cwd: request.cwd,
    env: request.env,
    stdio: "inherit",
  });
  if (child.error) {
    return { status: null, error: true };
  }
  return { status: child.status };
}

function pickDefined(
  envValue: string | undefined,
  fileValue: string | undefined,
): string | undefined {
  return envValue !== undefined ? envValue : fileValue;
}

function errorMessage(error: unknown): string {
  if (
    error instanceof LabDatabaseTargetError ||
    error instanceof LabEnvironmentFileError
  ) {
    return error.message;
  }
  return "Lab database target was rejected.";
}

function isMissingFile(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "ENOENT"
  );
}

function invokedDirectly(): boolean {
  const entry = process.argv[1];
  if (!entry) {
    return false;
  }
  return import.meta.url === pathToFileURL(path.resolve(entry)).href;
}

if (invokedDirectly()) {
  process.exitCode = runLabPrismaCli({
    action: process.argv[2],
    env: process.env,
    envFilePath: labEnvFilePath(),
    backendRoot: labBackendRoot(),
    schemaPath: labSchemaPath(),
    runPrisma: defaultPrismaRunner,
  });
}
