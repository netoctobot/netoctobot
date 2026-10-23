import path from "node:path";
import { pathToFileURL } from "node:url";
import { isLiveCommand, LIVE_COMMANDS } from "./commands.js";
import { runFixture } from "./fixture.js";
import { redactError, redactSecrets } from "./redact.js";

/** Fixture only. Live commands are loaded on demand so fixture mode never imports teleproto or the lab client. */
export function startLab(mode: string) {
  if (mode !== "fixture") {
    throw new Error("startLab accepts fixture mode only");
  }
  return runFixture();
}

const KNOWN_ERRORS = new Set([
  "LabConfigError",
  "LabUsageError",
  "LabDatabaseTargetError",
  "LabTestDatabaseError",
  "LabLockDeniedError",
  "LabLoginError",
  "SessionExistsError",
  "NoTrialRunError",
  "LabClientMissingError",
  "LabKeyConflictError",
  "LabPersistenceError",
  "RequestIdentityConflictError",
]);

export async function mainCommand(argv: readonly string[], env: NodeJS.ProcessEnv): Promise<number> {
  const command = argv[0] ?? "fixture";
  if (command === "fixture") {
    process.stdout.write(`${JSON.stringify(startLab("fixture"), null, 2)}\n`);
    return 0;
  }
  if (!isLiveCommand(command)) {
    process.stderr.write(`Unknown cpm-lab command. Use fixture or one of: ${LIVE_COMMANDS.join(", ")}.\n`);
    return 1;
  }
  const [{ runLiveCommand }, { labSecrets }] = await Promise.all([
    import("./live.js"),
    import("./config.js"),
  ]);
  try {
    return await runLiveCommand(command, argv.slice(1), env);
  } catch (error) {
    const secrets = labSecrets(env);
    const name = error instanceof Error ? error.name : "";
    process.stderr.write(
      `${KNOWN_ERRORS.has(name) ? redactSecrets(`${name}: ${(error as Error).message}`, secrets) : redactError(error, secrets)}\n`,
    );
    return 1;
  }
}

function invokedDirectly(): boolean {
  const entry = process.argv[1];
  if (!entry) {
    return false;
  }
  return import.meta.url === pathToFileURL(path.resolve(entry)).href;
}

if (invokedDirectly()) {
  mainCommand(process.argv.slice(2), process.env).then(
    (code) => {
      process.exitCode = code;
    },
    (error: unknown) => {
      process.stderr.write(`${redactError(error, [])}\n`);
      process.exitCode = 1;
    },
  );
}
