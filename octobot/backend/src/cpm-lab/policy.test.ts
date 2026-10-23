import assert from "node:assert/strict";
import test from "node:test";
import { actionForError, buildSchedule, floodDecision, LAB_LIMITS, plannedSendTime, requestKey } from "./policy.js";

test("error actions follow the lab policy", () => {
  assert.equal(actionForError("FLOOD_WAIT", false), "skip_slot");
  for (const errorClass of ["TIMEOUT", "NETWORK", "INTERNAL"] as const) {
    assert.equal(actionForError(errorClass, false), "retry_once");
    assert.equal(actionForError(errorClass, true), "skip_slot");
  }
  for (const errorClass of ["AUTH_KEY_DUPLICATED", "SESSION_REVOKED", "USER_DEACTIVATED", "FROZEN"] as const) {
    assert.equal(actionForError(errorClass, false), "stop_reader");
  }
  for (const errorClass of ["CHANNEL_PRIVATE", "CHANNEL_INVALID", "MSG_ID_INVALID", "PEER_INVALID", "INTEGRITY", "MIGRATE", "UNKNOWN", "ABORTED"] as const) {
    assert.equal(actionForError(errorClass, false), "stop_run");
  }
});

test("flood stop rule: over one hour, or the third event in the last 24 hours", () => {
  assert.deepEqual(floodDecision({ priorEventsInWindow: 0, seconds: 3600 }), { stopReader: false, reason: null });
  assert.equal(floodDecision({ priorEventsInWindow: 0, seconds: 3601 }).reason, "flood_wait_over_one_hour");
  assert.equal(floodDecision({ priorEventsInWindow: 1, seconds: 5 }).stopReader, false);
  assert.equal(floodDecision({ priorEventsInWindow: 2, seconds: 5 }).reason, "third_flood_wait_in_24h");
  assert.equal(LAB_LIMITS.floodWindowMs, 86_400_000);
});

test("schedule rounds and skip late slots without backlog", () => {
  const start = new Date("2026-10-24T06:00:00Z");
  const rounds = buildSchedule({ startAt: start, rounds: 12, intervalMs: 300_000 });
  assert.equal(rounds.length, 12);
  assert.equal(rounds[11]?.dueAt.toISOString(), "2026-10-24T06:55:00.000Z");
  assert.equal(rounds[0]?.deadline.toISOString(), "2026-10-24T06:05:00.000Z");

  const round = rounds[1]!;
  const now = start;
  const spaced = plannedSendTime({ now, dueAt: round.dueAt, deadline: round.deadline, nextAllowedAt: null, lastRequestedAt: new Date(round.dueAt.getTime() - 1000) });
  assert.equal(spaced.sendAt.getTime() - round.dueAt.getTime(), 2000);
  assert.equal(spaced.skip, false);

  const flooded = plannedSendTime({ now, dueAt: round.dueAt, deadline: round.deadline, nextAllowedAt: round.deadline, lastRequestedAt: null });
  assert.deepEqual([flooded.skip, flooded.reason], [true, "flood_wait"]);
  const late = plannedSendTime({ now, dueAt: round.dueAt, deadline: round.deadline, nextAllowedAt: null, lastRequestedAt: new Date(round.deadline.getTime() - 1000) });
  assert.deepEqual([late.skip, late.reason], [true, "late"]);
});

test("the current time is part of the plan: a round that already ended is skipped", () => {
  const [round] = buildSchedule({ startAt: new Date("2026-10-24T06:00:00Z"), rounds: 1, intervalMs: 300_000 });
  const inside = new Date(round!.dueAt.getTime() + 120_000);
  const midRound = plannedSendTime({ now: inside, dueAt: round!.dueAt, deadline: round!.deadline, nextAllowedAt: null, lastRequestedAt: null });
  assert.deepEqual([midRound.skip, midRound.sendAt.getTime()], [false, inside.getTime()]);

  for (const now of [round!.deadline, new Date(round!.deadline.getTime() + 3_600_000)]) {
    const ended = plannedSendTime({ now, dueAt: round!.dueAt, deadline: round!.deadline, nextAllowedAt: null, lastRequestedAt: null });
    assert.deepEqual([ended.skip, ended.reason], [true, "deadline"]);
  }
});

test("request keys are deterministic and retries get their own key", () => {
  assert.equal(requestKey({ purpose: "trial", reader: "BOT_CHANNELS_GET_MESSAGES", round: 3 }), "trial:r3:BOT_CHANNELS_GET_MESSAGES");
  assert.equal(requestKey({ purpose: "preflight", reader: "USER_GET_MESSAGES_VIEWS", retry: true }), "preflight:USER_GET_MESSAGES_VIEWS:retry1");
});
