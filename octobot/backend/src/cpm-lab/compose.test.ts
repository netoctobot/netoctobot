import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";

const composePath = fileURLToPath(new URL("../../../docker-compose.yml", import.meta.url));

const LAB_KEYS = [
  "LAB_DATABASE_URL",
  "LAB_TEST_DATABASE_URL",
  "DATABASE_URL",
  "LAB_API_ID",
  "LAB_API_HASH",
  "LAB_BOT_TOKEN",
  "LAB_SESSION_ENCRYPTION_KEY",
  "LAB_CHANNEL_ID",
  "LAB_POST_ID",
  "LAB_CHANNEL_USERNAME",
  "LAB_CHANNEL_INVITE_LINK",
  "LAB_TRIAL_ROUNDS",
  "LAB_TRIAL_INTERVAL_SECONDS",
];

const FAKE_LAB = {
  LAB_POSTGRES_USER: "cpm_lab",
  LAB_POSTGRES_PASSWORD: "fake-lab-postgres-password",
  LAB_POSTGRES_DB: "cpm_lab",
  LAB_DATABASE_URL: "postgresql://cpm_lab:fake-lab-postgres-password@lab-postgres:5432/cpm_lab",
  LAB_TEST_DATABASE_URL: "postgresql://cpm_lab:fake-lab-postgres-password@lab-postgres:5432/cpm_lab_test",
  LAB_API_ID: "12345",
  LAB_API_HASH: "fakefakefakefakefakefakefakefake",
  LAB_BOT_TOKEN: "123456:fake-lab-bot-token-value-xxxxxxxxxxxx",
  LAB_SESSION_ENCRYPTION_KEY: "c".repeat(64),
  LAB_CHANNEL_ID: "-1001234567890",
  LAB_POST_ID: "42",
};
const FAKE_APP = {
  POSTGRES_USER: "octobot",
  POSTGRES_PASSWORD: "fake-app-postgres-password",
  POSTGRES_DB: "octobot",
  DATABASE_URL: "postgresql://octobot:fake-app-postgres-password@postgres:5432/octobot",
  ENCRYPTION_KEY: "d".repeat(64),
  BOT_TOKEN: "654321:fake-app-bot-token-value-yyyyyyyyyyyy",
};
const LAB_SECRETS = [FAKE_LAB.LAB_API_HASH, FAKE_LAB.LAB_BOT_TOKEN, FAKE_LAB.LAB_SESSION_ENCRYPTION_KEY, FAKE_LAB.LAB_POSTGRES_PASSWORD];
const APP_SECRETS = [FAKE_APP.POSTGRES_PASSWORD, FAKE_APP.ENCRYPTION_KEY, FAKE_APP.BOT_TOKEN];

type Service = { environment?: Record<string, string | null>; env_file?: unknown; profiles?: string[] };

test("compose file: lab services list their variables and use no env_file", () => {
  const services = (parse(readFileSync(composePath, "utf8")) as { services: Record<string, Service> }).services;
  const labDb = services["lab-postgres"]!;
  const lab = services["cpm-lab"]!;
  assert.deepEqual(labDb.profiles, ["cpm-lab"]);
  assert.deepEqual(lab.profiles, ["cpm-lab"]);
  assert.equal(labDb.env_file, undefined);
  assert.equal(lab.env_file, undefined);
  assert.deepEqual(Object.keys(labDb.environment ?? {}).sort(), ["POSTGRES_DB", "POSTGRES_PASSWORD", "POSTGRES_USER"]);
  assert.deepEqual(Object.keys(lab.environment ?? {}).sort(), [...LAB_KEYS].sort());
  assert.equal(lab.environment?.DATABASE_URL, "${LAB_APP_DATABASE_TARGET:-}");
  assert.deepEqual(services.backend?.env_file, ["backend/.env"]);
  assert.equal(Object.keys(services.backend?.environment ?? {}).some((key) => key.startsWith("LAB_")), false);
});

function composeBinary(): string[] | null {
  const configured = process.env.DOCKER_COMPOSE_BIN;
  const candidates = configured ? [[configured]] : [["docker", "compose"], ["docker-compose"]];
  for (const candidate of candidates) {
    const probe = spawnSync(candidate[0]!, [...candidate.slice(1), "version"], { encoding: "utf8" });
    if (probe.status === 0) return candidate;
  }
  return null;
}

const binary = composeBinary();

test("docker compose config: each service receives only its own secrets", { skip: binary ? false : "docker compose is not installed" }, () => {
  const dir = mkdtempSync(path.join(tmpdir(), "cpm-lab-compose-"));
  try {
    mkdirSync(path.join(dir, "backend"));
    copyFileSync(composePath, path.join(dir, "docker-compose.yml"));
    const envFile = (values: Record<string, string>) => Object.entries(values).map(([key, value]) => `${key}=${value}`).join("\n");
    writeFileSync(path.join(dir, "backend/.env"), envFile(FAKE_APP));
    writeFileSync(path.join(dir, "backend/.env.lab"), envFile(FAKE_LAB));
    const run = (args: string[], env: Record<string, string> = {}) => {
      const result = spawnSync(binary![0]!, [...binary!.slice(1), ...args, "config", "--format", "json"], {
        cwd: dir,
        encoding: "utf8",
        env: { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? dir, ...env },
      });
      assert.equal(result.status, 0, result.stderr);
      return JSON.parse(result.stdout) as { services: Record<string, Service> };
    };

    const lab = run(
      ["--env-file", "backend/.env", "--env-file", "backend/.env.lab", "--profile", "cpm-lab"],
      { LAB_APP_DATABASE_TARGET: "postgresql://postgres:5432/octobot" },
    ).services;
    const values = (service: Service) => Object.values(service.environment ?? {}).map(String);

    const labDb = lab["lab-postgres"]!;
    assert.deepEqual(Object.keys(labDb.environment ?? {}).sort(), ["POSTGRES_DB", "POSTGRES_PASSWORD", "POSTGRES_USER"]);
    assert.equal(labDb.environment?.POSTGRES_PASSWORD, FAKE_LAB.LAB_POSTGRES_PASSWORD);
    for (const secret of [FAKE_LAB.LAB_API_HASH, FAKE_LAB.LAB_BOT_TOKEN, FAKE_LAB.LAB_SESSION_ENCRYPTION_KEY, ...APP_SECRETS]) {
      assert.equal(values(labDb).some((value) => value.includes(secret)), false);
    }

    const cpmLab = lab["cpm-lab"]!;
    assert.deepEqual(Object.keys(cpmLab.environment ?? {}).sort(), [...LAB_KEYS].sort());
    assert.equal(cpmLab.environment?.DATABASE_URL, "postgresql://postgres:5432/octobot");
    for (const secret of APP_SECRETS) {
      assert.equal(values(cpmLab).some((value) => value.includes(secret)), false);
    }

    const backend = lab.backend!;
    assert.equal(Object.keys(backend.environment ?? {}).some((key) => key.startsWith("LAB_")), false);
    for (const secret of LAB_SECRETS) {
      assert.equal(values(backend).some((value) => value.includes(secret)), false);
    }
    assert.equal(values(lab.postgres!).some((value) => LAB_SECRETS.some((secret) => value.includes(secret))), false);

    const app = run(["--env-file", "backend/.env"]).services;
    assert.equal(app["cpm-lab"], undefined);
    assert.equal(app["lab-postgres"], undefined);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
