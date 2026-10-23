import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import test from "node:test";

test("SIGTERM during a wait stops the lab process within 60 seconds", async () => {
  const child = spawn(process.execPath, ["--import", "tsx", "src/cpm-lab/lab-signal-harness.ts"], {
    cwd: new URL("../..", import.meta.url).pathname,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  let exitCode: number | null = null;
  let exited = false;
  child.stdout?.on("data", (chunk) => {
    output += String(chunk);
  });
  child.stderr?.on("data", (chunk) => {
    output += String(chunk);
  });
  child.once("exit", (code) => {
    exited = true;
    exitCode = code;
  });

  const startedAt = Date.now();
  while (!output.includes("started (PREFLIGHT)")) {
    if (exited) {
      throw new Error(`harness exited before the wait with ${exitCode}: ${output}`);
    }
    if (Date.now() - startedAt > 15_000) {
      child.kill("SIGKILL");
      throw new Error(`harness did not reach the wait: ${output}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }

  const sentAt = Date.now();
  child.kill("SIGTERM");
  while (!exited) {
    if (Date.now() - sentAt > 60_000) {
      child.kill("SIGKILL");
      throw new Error("the lab process was still running 60 seconds after SIGTERM");
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  const elapsedMs = Date.now() - sentAt;
  assert.equal(exitCode, 0);
  assert.ok(elapsedMs < 60_000, `exit took ${elapsedMs}ms`);
  assert.match(output, /"stopReason":"signal"/);
});
