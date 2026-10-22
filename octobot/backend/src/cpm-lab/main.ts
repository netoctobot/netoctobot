import path from "node:path";
import { pathToFileURL } from "node:url";
import { runFixture } from "./fixture.js";
import { redactError } from "./redact.js";

export function startLab(mode: string) {
  if (mode !== "fixture") {
    throw new Error("cpm-lab A1 accepts fixture mode only");
  }
  return runFixture();
}

function invokedDirectly(): boolean {
  const entry = process.argv[1];
  if (!entry) {
    return false;
  }
  return import.meta.url === pathToFileURL(path.resolve(entry)).href;
}

if (invokedDirectly()) {
  try {
    const report = startLab(process.argv[2] ?? "fixture");
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`${redactError(error, [])}\n`);
    process.exitCode = 1;
  }
}
