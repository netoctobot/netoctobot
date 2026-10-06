import assert from "node:assert/strict";
import test from "node:test";
import { SupportedLanguage } from "@prisma/client";
import { GrammyError, HttpError } from "grammy";
import ar from "../../locales/ar.json" with { type: "json" };
import en from "../../locales/en.json" with { type: "json" };
import { translate } from "../localization/localization.service.js";
import { userCanPromote } from "./access.js";
import {
  MAX_ACCEPTED_CHANNELS,
  PUBLISH_GRACE_MINUTES,
  SEND_DELAY_ALLOWANCE_MINUTES,
} from "./constants.js";
import { classifySendFailure, occupiedUntil } from "./delivery.js";
import { parseContactUrl, parseListName } from "./contact-url.js";
import {
  acceptanceDecision,
  claimAcceptedSlot,
  disableReasonCodes,
  isPublishable,
  occupiesAcceptedSlot,
} from "./eligibility.js";
import {
  buttonLabel,
  nextRotationOffset,
  renderSupportList,
  rotateEntries,
} from "./render.js";
import { buildSlotsMenu } from "./menu.js";
import {
  capturedRetentionMinutes,
  defaultDayClocks,
  deleteAtFromSuccessfulSend,
  formatInTimeZone,
  isOverdueForResume,
  minimumSlotGapMinutes,
  pendingCycleCanBeReplaced,
  readCustomSlots,
  savedCustomSchedule,
  shouldSkipBacklog,
  slotsForHorizon,
  validateCustomSchedule,
  validateCustomSlots,
  zonedTimeToUtc,
} from "./schedule.js";

test("accepted slots ignore pending, rejected, and deleted rows", () => {
  assert.equal(
    occupiesAcceptedSlot({
      acceptanceStatus: "ACCEPTED",
      deletedAt: null,
    }),
    true,
  );
  assert.equal(
    occupiesAcceptedSlot({
      acceptanceStatus: "ACCEPTED",
      deletedAt: new Date(),
    }),
    false,
  );
  assert.equal(
    occupiesAcceptedSlot({
      acceptanceStatus: "PENDING",
      deletedAt: null,
    }),
    false,
  );
  assert.equal(claimAcceptedSlot(MAX_ACCEPTED_CHANNELS - 1), true);
  assert.equal(claimAcceptedSlot(MAX_ACCEPTED_CHANNELS), false);
  assert.equal(
    acceptanceDecision({ mode: "MANUAL", acceptedCount: 30 }),
    "pending",
  );
  assert.equal(
    acceptanceDecision({ mode: "AUTO", acceptedCount: 30 }),
    "full",
  );
  assert.equal(
    acceptanceDecision({ mode: "AUTO", acceptedCount: 29 }),
    "accept",
  );
});

test("disable reasons stay independent", () => {
  const flags = {
    participantDisabled: true,
    adminDisabled: true,
    adminDisableReason: "spam",
    permissionsLost: false,
    inviteUnavailable: true,
  };
  assert.deepEqual(disableReasonCodes(flags), [
    "participant",
    "admin",
    "invite",
  ]);
  assert.equal(
    isPublishable({
      acceptanceStatus: "ACCEPTED",
      deletedAt: null,
      ...flags,
      participantDisabled: false,
      adminDisabled: false,
      inviteUnavailable: false,
    }),
    true,
  );
  assert.equal(
    isPublishable({
      acceptanceStatus: "ACCEPTED",
      deletedAt: null,
      ...flags,
    }),
    false,
  );
});

test("custom times reject overlap, duplicates, and the 48 hour delete window", () => {
  assert.equal(
    validateCustomSchedule(
      [
        { hour: 9, minute: 0 },
        { hour: 21, minute: 0 },
      ],
      180,
    ).ok,
    true,
  );
  assert.deepEqual(
    validateCustomSchedule(
      [
        { hour: 9, minute: 0 },
        { hour: 11, minute: 0 },
      ],
      180,
    ),
    { ok: false, reason: "overlap" },
  );
  assert.deepEqual(
    validateCustomSchedule([{ hour: 9, minute: 0 }], 47 * 60),
    { ok: false, reason: "overlap" },
  );
  assert.deepEqual(
    validateCustomSchedule([{ hour: 9, minute: 0 }], 48 * 60),
    { ok: false, reason: "retention" },
  );
  assert.deepEqual(
    validateCustomSchedule(
      [
        { hour: 9, minute: 0 },
        { hour: 9, minute: 0 },
      ],
      180,
    ),
    { ok: false, reason: "duplicate" },
  );
});

test("default daily windows do not overlap a 3 hour post after send delay", () => {
  const gap = minimumSlotGapMinutes(180);
  assert.equal(gap, 180 + SEND_DELAY_ALLOWANCE_MINUTES + 10);
  for (let index = 0; index < 50; index += 1) {
    const [morning, evening] = defaultDayClocks(() => index / 50);
    const morningEnd = morning.hour * 60 + morning.minute + gap;
    const eveningStart = evening.hour * 60 + evening.minute;
    assert.ok(morningEnd <= eveningStart);
    assert.ok(morning.hour >= 8 && morning.hour <= 10);
    assert.ok(evening.hour >= 17 && evening.hour <= 19);
  }
  assert.ok(10 * 60 + 59 + gap <= 17 * 60);
});

test("saved civil times stay fixed in UTC and Asia/Riyadh", () => {
  const utc = zonedTimeToUtc(2026, 10, 5, 9, 30, "UTC");
  assert.equal(utc.toISOString(), "2026-10-05T09:30:00.000Z");
  const riyadh = zonedTimeToUtc(2026, 10, 5, 9, 30, "Asia/Riyadh");
  assert.equal(riyadh.toISOString(), "2026-10-05T06:30:00.000Z");
  assert.equal(formatInTimeZone(riyadh, "Asia/Riyadh"), "2026-10-05 09:30");
  const slots = slotsForHorizon({
    from: new Date("2026-10-05T00:00:00.000Z"),
    timeZone: "UTC",
    days: 1,
    retentionMinutes: 180,
    clocksForDay: () => [{ hour: 9, minute: 30 }],
  });
  assert.equal(slots[0]?.scheduledAt.toISOString(), "2026-10-05T09:30:00.000Z");
  assert.equal(slots[0]?.deleteAt.toISOString(), "2026-10-05T12:30:00.000Z");
});

test("custom times keep room for a delayed send", () => {
  assert.equal(
    validateCustomSchedule(
      [
        { hour: 9, minute: 0 },
        { hour: 12, minute: 30 },
      ],
      180,
    ).ok,
    false,
  );
  assert.equal(
    validateCustomSchedule(
      [
        { hour: 9, minute: 0 },
        { hour: 12, minute: 40 },
      ],
      180,
    ).ok,
    true,
  );
});

test("delete time is counted from the successful send", () => {
  const sentAt = new Date("2026-10-06T10:20:00.000Z");
  const deleteAt = deleteAtFromSuccessfulSend(sentAt, 180);
  assert.equal(deleteAt.toISOString(), "2026-10-06T13:20:00.000Z");
  assert.equal(deleteAt.getTime() - sentAt.getTime(), 180 * 60_000);
});

test("a late backlog is skipped and resume treats due cycles as missed", () => {
  const now = new Date("2026-10-06T12:00:00.000Z");
  const recent = new Date(now.getTime() - (PUBLISH_GRACE_MINUTES - 1) * 60_000);
  const missed = new Date(now.getTime() - (PUBLISH_GRACE_MINUTES + 1) * 60_000);
  assert.equal(shouldSkipBacklog(recent, now), false);
  assert.equal(shouldSkipBacklog(missed, now), true);
  assert.equal(isOverdueForResume(now, now), true);
  assert.equal(
    isOverdueForResume(new Date(now.getTime() + 60_000), now),
    false,
  );
});

test("an unknown send is not treated as a safe retry", () => {
  const grammy = (code: number) =>
    new GrammyError(
      "telegram",
      { ok: false, error_code: code, description: "telegram" },
      "sendMessage",
      {},
    );
  assert.equal(classifySendFailure(grammy(429)), "retry");
  assert.equal(classifySendFailure(grammy(403)), "rejected");
  assert.equal(classifySendFailure(grammy(500)), "unknown");
  assert.equal(
    classifySendFailure(new HttpError("timeout", new Error("socket hang up"))),
    "unknown",
  );
});

test("a live previous post holds the next cycle until its own delete time", () => {
  const now = new Date("2026-10-06T12:00:00.000Z");
  const deleteAt = new Date("2026-10-06T15:00:00.000Z");
  const held = occupiedUntil({
    now,
    currentCycleId: "next",
    retentionMinutes: 180,
    publications: [
      {
        cycleId: "previous",
        status: "SENT",
        deleteAt,
        sendAttemptedAt: new Date("2026-10-06T12:00:00.000Z"),
      },
      {
        cycleId: "next",
        status: "SENT",
        deleteAt: new Date("2026-10-06T18:00:00.000Z"),
        sendAttemptedAt: now,
      },
    ],
  });
  assert.equal(held?.toISOString(), deleteAt.toISOString());
  const uncertain = occupiedUntil({
    now,
    currentCycleId: "next",
    retentionMinutes: 180,
    publications: [
      {
        cycleId: "previous",
        status: "UNCONFIRMED",
        deleteAt: new Date("2026-10-06T12:00:00.000Z"),
        sendAttemptedAt: new Date("2026-10-06T11:30:00.000Z"),
      },
    ],
  });
  assert.equal(uncertain?.toISOString(), "2026-10-06T14:30:00.000Z");
});

test("each custom slot keeps its own duration across midnight", () => {
  assert.equal(
    validateCustomSlots([
      { time: { hour: 22, minute: 0 }, retentionMinutes: 180 },
      { time: { hour: 1, minute: 0 }, retentionMinutes: 60 },
    ]).ok,
    false,
  );
  assert.equal(
    validateCustomSlots([
      { time: { hour: 20, minute: 0 }, retentionMinutes: 60 },
      { time: { hour: 8, minute: 0 }, retentionMinutes: 180 },
    ]).ok,
    true,
  );
  assert.equal(
    validateCustomSlots([
      { time: { hour: 9, minute: 0 }, retentionMinutes: 180 },
      { time: { hour: 12, minute: 30 }, retentionMinutes: 15 },
    ]).ok,
    false,
  );
});

test("legacy time strings use the shared duration", () => {
  const legacy = readCustomSlots(["09:30", "21:00"], 90);
  assert.deepEqual(
    legacy.map((slot) => slot.retentionMinutes),
    [90, 90],
  );
  const stored = readCustomSlots(
    [{ time: "09:30", retentionMinutes: 60 }],
    180,
  );
  assert.equal(stored[0]?.retentionMinutes, 60);
  assert.equal(savedCustomSchedule(stored).scheduleMode, "CUSTOM");
});

test("a sent post keeps the retention captured on its cycle", () => {
  const scheduledAt = new Date("2026-10-06T09:00:00.000Z");
  const plannedDelete = new Date("2026-10-06T10:00:00.000Z");
  const retention = capturedRetentionMinutes(scheduledAt, plannedDelete);
  assert.equal(retention, 60);
  assert.equal(
    deleteAtFromSuccessfulSend(
      new Date("2026-10-06T09:05:00.000Z"),
      retention,
    ).toISOString(),
    "2026-10-06T10:05:00.000Z",
  );
  assert.equal(
    pendingCycleCanBeReplaced({ status: "PENDING", publicationCount: 0 }),
    true,
  );
  assert.equal(
    pendingCycleCanBeReplaced({ status: "PENDING", publicationCount: 1 }),
    false,
  );
  assert.equal(
    pendingCycleCanBeReplaced({ status: "PUBLISHED", publicationCount: 1 }),
    false,
  );
});

test("default times screen explains the schedule without edit buttons", () => {
  assert.equal(
    ar.supportList.defaultSlots,
    "الجدولة افتراضية: يُختار موعدان للنشر يوميًا، وتبقى القائمة 3 ساعات",
  );
  const view = buildSlotsMenu(SupportedLanguage.EN, "DEFAULT", [
    { time: "09:30", retentionMinutes: 180 },
  ]);
  const callbacks = view.keyboard.inline_keyboard
    .flat()
    .map((button) => ("callback_data" in button ? button.callback_data : ""));
  assert.deepEqual(callbacks, ["sl:sched"]);
  const custom = buildSlotsMenu(SupportedLanguage.EN, "CUSTOM", [
    { time: "09:30", retentionMinutes: 180 },
  ]);
  const row = custom.keyboard.inline_keyboard[0] ?? [];
  assert.deepEqual(
    row.map((button) => ("callback_data" in button ? button.callback_data : "")),
    ["sl:slot:time:0", "sl:slot:keep:0", "sl:slot:del:0"],
  );
});

test("rotation is fair and new entries stay at the end until the next turn", () => {
  const entries = ["a", "b", "c"];
  assert.deepEqual(rotateEntries(entries, 0), ["a", "b", "c"]);
  assert.deepEqual(rotateEntries(entries, 1), ["b", "c", "a"]);
  assert.deepEqual(rotateEntries([...entries, "d"], 1), ["b", "c", "d", "a"]);
  assert.equal(nextRotationOffset(2, 3), 0);
});

test("text lists keep every url and refuse a message that cannot fit", () => {
  const fitted = renderSupportList({
    listName: "Education",
    format: "TEXT",
    entries: [
      { id: "1", title: "One", url: "https://t.me/one" },
      { id: "2", title: "Two", url: "https://t.me/two" },
    ],
  });
  assert.equal(fitted.ok, true);
  if (fitted.ok) {
    assert.match(fitted.rendered.text, /https:\/\/t\.me\/one/);
    assert.match(fitted.rendered.text, /https:\/\/t\.me\/two/);
    assert.deepEqual(fitted.rendered.memberIds, ["1", "2"]);
  }
  const tooLong = renderSupportList({
    listName: "News",
    format: "TEXT",
    entries: Array.from({ length: 30 }, (_, index) => ({
      id: String(index),
      title: "قناة".repeat(40),
      url: `https://t.me/${"channel".repeat(15)}${index}`,
    })),
  });
  assert.deepEqual(tooLong, { ok: false, reason: "unfit" });
});

test("button lists truncate labels without dropping urls", () => {
  const title = "م".repeat(80);
  const rendered = renderSupportList({
    listName: "Buttons",
    format: "BUTTONS",
    entries: [{ id: "1", title, url: "https://t.me/joinchat/abc" }],
  });
  assert.equal(rendered.ok, true);
  if (rendered.ok) {
    assert.equal(rendered.rendered.buttons?.[0]?.url, "https://t.me/joinchat/abc");
    assert.equal(Array.from(rendered.rendered.buttons?.[0]?.label ?? "").length, 64);
    assert.equal(buttonLabel(title).endsWith("…"), true);
  }
});

test("only a creator or an admin who can add admins may submit a channel", () => {
  assert.equal(
    userCanPromote({ status: "creator", user: { id: 1 } } as never),
    true,
  );
  assert.equal(
    userCanPromote({
      status: "administrator",
      user: { id: 1 },
      can_promote_members: true,
    } as never),
    true,
  );
  assert.equal(
    userCanPromote({
      status: "administrator",
      user: { id: 1 },
      can_promote_members: false,
    } as never),
    false,
  );
});

test("support-list copy exists in both languages", () => {
  const arabic = ar.supportList;
  const english = en.supportList;
  assert.deepEqual(Object.keys(arabic).sort(), Object.keys(english).sort());
  for (const key of Object.keys(arabic)) {
    const translationKey = `supportList.${key}` as "supportList.welcome";
    const variables = {
      listName: "X",
      count: 1,
      max: 30,
      title: "Y",
      status: "ok",
      reason: "spam",
      timeZone: "UTC",
      mode: "default",
      retention: 180,
      state: "on",
      next: "later",
      times: "09:00",
      channel: "C",
      minutes: 180,
      time: "09:30",
    };
    assert.equal(
      translate(SupportedLanguage.AR, translationKey, variables).includes("{{"),
      false,
    );
    assert.equal(
      translate(SupportedLanguage.EN, translationKey, variables).includes("{{"),
      false,
    );
  }
});

test("contact links and list names stay short", () => {
  assert.equal(parseContactUrl("@octobot"), "https://t.me/octobot");
  assert.equal(parseContactUrl("https://t.me/octobot"), "https://t.me/octobot");
  assert.equal(parseContactUrl("not a link"), null);
  assert.equal(parseListName("  قنوات التعليم  "), "قنوات التعليم");
  assert.equal(parseListName(""), null);
});
