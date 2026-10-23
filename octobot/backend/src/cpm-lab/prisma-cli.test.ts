import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  labBackendRoot,
  labEnvFilePath,
  labSchemaPath,
  type PrismaRunRequest,
  runLabPrismaCli,
} from "./prisma-cli.js";

const APP_PASSWORD = "app-secret-value";
const LAB_PASSWORD = "lab-secret-value";
const APP_URL = `postgresql://app_user:${APP_PASSWORD}@db.example:5432/octobot`;
const LAB_URL = `postgresql://lab_user:${LAB_PASSWORD}@lab.example:5432/cpm_lab`;
const SAME_LAB_URL = `postgresql://other_user:${LAB_PASSWORD}@DB.EXAMPLE/octobot?schema=cpm_lab`;

function capture() {
  let text = "";
  const calls: PrismaRunRequest[] = [];
  return {
    calls,
    stderr: {
      write(chunk: string) {
        text += chunk;
      },
    },
    text: () => text,
    runPrisma(request: PrismaRunRequest) {
      calls.push(request);
      return { status: 0 };
    },
  };
}

function assertNoSecrets(text: string) {
  assert.equal(text.includes(APP_PASSWORD), false);
  assert.equal(text.includes(LAB_PASSWORD), false);
  assert.equal(text.includes("postgresql://"), false);
  assert.equal(text.includes("postgres://"), false);
  assert.equal(text.includes(APP_URL), false);
  assert.equal(text.includes(LAB_URL), false);
}

test("module paths stay on the backend package for source and dist", () => {
  const source = new URL("file:///opt/app/backend/src/cpm-lab/prisma-cli.ts");
  const dist = new URL("file:///opt/app/backend/dist/cpm-lab/prisma-cli.js");
  for (const moduleUrl of [source, dist]) {
    assert.equal(labBackendRoot(moduleUrl), "/opt/app/backend");
    assert.equal(labEnvFilePath(moduleUrl), "/opt/app/backend/.env");
    assert.equal(
      labSchemaPath(moduleUrl),
      "/opt/app/backend/prisma-lab/schema.prisma",
    );
  }
});

test("a file-only application URL blocks the same lab target before Prisma starts", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "cpm-lab-env-"));
  const envFile = path.join(directory, ".env");
  writeFileSync(
    envFile,
    `DATABASE_URL="${APP_URL}"\nOTHER_SECRET="${APP_PASSWORD}-file"\n`,
  );
  const seen = capture();
  const status = runLabPrismaCli({
    action: "migrate",
    env: { LAB_DATABASE_URL: SAME_LAB_URL },
    envFilePath: envFile,
    backendRoot: "/opt/app/backend",
    schemaPath: "/opt/app/backend/prisma-lab/schema.prisma",
    runPrisma: seen.runPrisma,
    stderr: seen.stderr,
  });

  assert.equal(status, 1);
  assert.equal(seen.calls.length, 0);
  assert.match(seen.text(), /same host, port, and database/);
  assertNoSecrets(seen.text());
  assert.equal(seen.text().includes("OTHER_SECRET"), false);
});

test("lab:migrate rejects a missing, blank, or invalid application URL", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "cpm-lab-env-"));
  const cases = [
    { file: "LAB_ONLY=1\n", env: { LAB_DATABASE_URL: LAB_URL } },
    {
      file: `DATABASE_URL="${APP_URL}"\n`,
      env: { LAB_DATABASE_URL: LAB_URL, DATABASE_URL: "   " },
    },
    {
      file: `DATABASE_URL="not a database url ${APP_PASSWORD}"\n`,
      env: { LAB_DATABASE_URL: LAB_URL },
    },
  ];
  for (const [index, item] of cases.entries()) {
    const envFile = path.join(directory, `${index}.env`);
    writeFileSync(envFile, item.file);
    const seen = capture();
    const status = runLabPrismaCli({
      action: "migrate",
      env: item.env,
      envFilePath: envFile,
      backendRoot: "/opt/app/backend",
      schemaPath: "/opt/app/backend/prisma-lab/schema.prisma",
      runPrisma: seen.runPrisma,
      stderr: seen.stderr,
    });
    assert.equal(status, 1);
    assert.equal(seen.calls.length, 0);
    assertNoSecrets(seen.text());
  }
});

test("a distinct database reaches Prisma with the checked values and absolute schema", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "cpm-lab-env-"));
  const envFile = path.join(directory, ".env");
  const previous = process.cwd();
  process.chdir(directory);
  try {
    writeFileSync(envFile, `DATABASE_URL="${APP_URL}"\n`);
    const seen = capture();
    const status = runLabPrismaCli({
      action: "migrate",
      env: { LAB_DATABASE_URL: `  ${LAB_URL}  `, PATH: "/usr/bin" },
      envFilePath: envFile,
      backendRoot: labBackendRoot(),
      schemaPath: labSchemaPath(),
      runPrisma: seen.runPrisma,
      stderr: seen.stderr,
    });

    assert.equal(status, 0);
    assert.equal(seen.calls.length, 1);
    const request = seen.calls[0];
    assert.ok(request);
    assert.equal(request.cwd, labBackendRoot());
    assert.notEqual(request.cwd, directory);
    assert.deepEqual(request.args, [
      "exec",
      "prisma",
      "migrate",
      "deploy",
      "--schema",
      labSchemaPath(),
    ]);
    assert.equal(path.isAbsolute(request.args[5] ?? ""), true);
    assert.equal(request.env.LAB_DATABASE_URL, LAB_URL);
    assert.equal(request.env.DATABASE_URL, APP_URL);
    assert.equal(request.env.PATH, "/usr/bin");
    assert.equal(seen.text(), "");
  } finally {
    process.chdir(previous);
  }
});

test("environment values win over the env file in both directions", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "cpm-lab-env-"));
  const envFile = path.join(directory, ".env");
  writeFileSync(
    envFile,
    `DATABASE_URL="${APP_URL}"\nLAB_DATABASE_URL="${SAME_LAB_URL}"\n`,
  );

  const allowed = capture();
  const allowedStatus = runLabPrismaCli({
    action: "generate",
    env: { DATABASE_URL: APP_URL, LAB_DATABASE_URL: LAB_URL },
    envFilePath: envFile,
    backendRoot: "/opt/app/backend",
    schemaPath: "/opt/app/backend/prisma-lab/schema.prisma",
    runPrisma: allowed.runPrisma,
    stderr: allowed.stderr,
  });
  assert.equal(allowedStatus, 0);
  assert.equal(allowed.calls[0]?.env.LAB_DATABASE_URL, LAB_URL);
  assert.equal(allowed.calls[0]?.env.DATABASE_URL, APP_URL);
  assert.deepEqual(allowed.calls[0]?.args, [
    "exec",
    "prisma",
    "generate",
    "--schema",
    "/opt/app/backend/prisma-lab/schema.prisma",
  ]);

  const blocked = capture();
  const blockedStatus = runLabPrismaCli({
    action: "migrate",
    env: { DATABASE_URL: APP_URL, LAB_DATABASE_URL: SAME_LAB_URL },
    envFilePath: envFile,
    backendRoot: "/opt/app/backend",
    schemaPath: "/opt/app/backend/prisma-lab/schema.prisma",
    runPrisma: blocked.runPrisma,
    stderr: blocked.stderr,
  });
  assert.equal(blockedStatus, 1);
  assert.equal(blocked.calls.length, 0);
  assertNoSecrets(blocked.text());
});

test("a blank environment value wins and is passed through instead of the file", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "cpm-lab-env-"));
  const envFile = path.join(directory, ".env");
  writeFileSync(envFile, `DATABASE_URL="${APP_URL}"\n`);
  const seen = capture();
  const status = runLabPrismaCli({
    action: "generate",
    env: { LAB_DATABASE_URL: LAB_URL, DATABASE_URL: "   " },
    envFilePath: envFile,
    backendRoot: "/opt/app/backend",
    schemaPath: "/opt/app/backend/prisma-lab/schema.prisma",
    runPrisma: seen.runPrisma,
    stderr: seen.stderr,
  });

  assert.equal(status, 0);
  assert.equal(seen.calls.length, 1);
  assert.equal(seen.calls[0]?.env.DATABASE_URL, "   ");
  assert.equal(seen.calls[0]?.env.LAB_DATABASE_URL, LAB_URL);
  assert.equal(seen.calls[0]?.env.DATABASE_URL?.includes(APP_PASSWORD), false);
});

test("lab:generate runs without an application URL", () => {
  const missing = path.join(
    mkdtempSync(path.join(tmpdir(), "cpm-lab-env-")),
    "missing.env",
  );
  const seen = capture();
  const status = runLabPrismaCli({
    action: "generate",
    env: { LAB_DATABASE_URL: LAB_URL, DATABASE_URL: undefined },
    envFilePath: missing,
    backendRoot: "/opt/app/backend",
    schemaPath: "/opt/app/backend/prisma-lab/schema.prisma",
    runPrisma: seen.runPrisma,
    stderr: seen.stderr,
  });

  assert.equal(status, 0);
  assert.equal(seen.calls.length, 1);
  assert.equal(seen.calls[0]?.env.LAB_DATABASE_URL, LAB_URL);
  assert.equal(seen.calls[0]?.env.DATABASE_URL, undefined);
  assert.equal(seen.text(), "");
});

test("a read error other than a missing file rejects the command", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "cpm-lab-env-"));
  const seen = capture();
  const status = runLabPrismaCli({
    action: "migrate",
    env: { LAB_DATABASE_URL: LAB_URL, DATABASE_URL: APP_URL },
    envFilePath: directory,
    backendRoot: "/opt/app/backend",
    schemaPath: "/opt/app/backend/prisma-lab/schema.prisma",
    runPrisma: seen.runPrisma,
    stderr: seen.stderr,
  });

  assert.equal(status, 1);
  assert.equal(seen.calls.length, 0);
  assert.match(seen.text(), /could not be read/);
  assert.equal(seen.text().includes(directory), false);
  assertNoSecrets(seen.text());
});
