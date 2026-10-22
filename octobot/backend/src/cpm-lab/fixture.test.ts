import assert from "node:assert/strict";
import test from "node:test";
import { runFixture } from "./fixture.js";
import { startLab } from "./main.js";

test("fixture report separates load, readings, and injected faults", () => {
  const report = runFixture();

  assert.equal(report.mode, "fixture");
  assert.equal(report.telegramNotContacted, true);
  assert.equal(report.databaseNotContacted, true);
  assert.equal(report.libraryNotContacted, true);
  assert.equal(report.commercialCpmEnabled, false);
  assert.equal(report.provesTelegramBehavior, false);
  assert.equal(report.secondAccountRequiredForInitialSetup, false);
  assert.equal(report.automaticAccountSwitch, false);
  assert.equal(report.posts, 100);
  assert.equal(report.channels, 3);
  assert.equal(report.plannedRequests, 7);
  assert.equal(report.plannedRequestsIfPostsWereOneChannel, 5);
  assert.equal(report.requestsStored, 1);
  assert.equal(report.readingsStored, 3);
  assert.equal(report.multiPostSave.rereadInserted, 0);
  assert.equal(report.multiPostSave.readingsAfterReread, 3);
  assert.equal(report.injectedFloodWait.countedInTelegramMetrics, false);
  assert.equal(JSON.stringify(report).includes("lab-session"), false);
});

test("A1 rejects every mode except fixture", () => {
  assert.throws(() => startLab("live"), /fixture mode only/);
  assert.equal(startLab("fixture").plannedRequests, 7);
});
