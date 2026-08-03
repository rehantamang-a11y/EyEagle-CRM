import assert from "node:assert/strict";
import test from "node:test";
import {
  activityEnd, bufferMinutesFor, completeActivitySchema, createLeadSchema,
  defaultReminderMinutes, escapeLikePattern, localClock, normalizeIndianPhone,
  rangesConflict, scheduleActivitySchema, withinCallingWindow, withinCustomerPreference,
} from "./index.js";

test("normalizes common Indian phone formats", () => {
  assert.equal(normalizeIndianPhone("98765 43210"), "+919876543210");
  assert.equal(normalizeIndianPhone("09876543210"), "+919876543210");
  assert.equal(normalizeIndianPhone("+91-98765-43210"), "+919876543210");
  assert.equal(normalizeIndianPhone("919876543210"), "+919876543210");
});

test("detects overlap including buffers", () => {
  const aStart = new Date("2026-08-12T06:00:00Z");
  const aEnd = new Date("2026-08-12T06:15:00Z");
  assert.equal(rangesConflict(aStart, aEnd, new Date("2026-08-12T06:20:00Z"), new Date("2026-08-12T06:35:00Z"), 5), false);
  assert.equal(rangesConflict(aStart, aEnd, new Date("2026-08-12T06:19:00Z"), new Date("2026-08-12T06:34:00Z"), 5), true);
});

test("applies channel defaults", () => {
  assert.deepEqual(defaultReminderMinutes("call"), [1440, 30]);
  assert.deepEqual(defaultReminderMinutes("bathroom_audit"), [1440, 120, 30]);
});

test("visits and audits get a longer buffer than calls", () => {
  assert.equal(bufferMinutesFor("call"), 5);
  assert.equal(bufferMinutesFor("whatsapp"), 5);
  assert.equal(bufferMinutesFor("home_visit"), 15);
  assert.equal(bufferMinutesFor("bathroom_audit"), 15);
});

test("the library's own reminder defaults pass its schema", () => {
  // defaultReminderMinutes returned [0] while the schema demanded a positive
  // integer, so every client using the shipped defaults got a 422.
  for (const type of ["call", "email", "send_proposal", "general_task", "bathroom_audit"] as const) {
    const parsed = scheduleActivitySchema.parse({
      leadId: "6f8f1f4c-0f7a-4a4b-9e5a-1a2b3c4d5e6f",
      type,
      title: "Follow up",
      scheduledStart: "2026-08-12T06:00:00.000Z",
      durationMinutes: 30,
      reminderMinutes: defaultReminderMinutes(type),
    });
    assert.deepEqual(parsed.reminderMinutes, [...defaultReminderMinutes(type)].sort((a, b) => b - a));
  }
});

test("reminder minutes are de-duplicated and ordered furthest-out first", () => {
  const parsed = scheduleActivitySchema.parse({
    leadId: "6f8f1f4c-0f7a-4a4b-9e5a-1a2b3c4d5e6f",
    type: "call",
    title: "Follow up",
    scheduledStart: "2026-08-12T06:00:00.000Z",
    durationMinutes: 30,
    reminderMinutes: [30, 1440, 30, 120],
  });
  assert.deepEqual(parsed.reminderMinutes, [1440, 120, 30]);
});

test("completing an activity must resolve the follow-up chain", () => {
  const base = { outcome: "connected", notes: "Spoke to the daughter." };

  // No branch at all is rejected: this is the case that used to silently leave
  // the lead with no next action.
  assert.throws(() => completeActivitySchema.parse(base));

  // "none" is allowed but has to be justified.
  assert.throws(() => completeActivitySchema.parse({ ...base, next: "none" }));
  assert.throws(() => completeActivitySchema.parse({ ...base, next: "none", noNextActionReason: "later" }));
  const justified = completeActivitySchema.parse({
    ...base, next: "none", noNextActionReason: "Customer is travelling until September.",
  });
  assert.equal(justified.next, "none");

  const scheduled = completeActivitySchema.parse({
    ...base,
    next: "schedule",
    followUp: {
      type: "call", title: "Confirm audit date",
      scheduledStart: "2026-08-14T06:00:00.000Z", durationMinutes: 15,
      reminderMinutes: [1440, 30],
    },
  });
  assert.equal(scheduled.next, "schedule");

  const closed = completeActivitySchema.parse({
    ...base, next: "close", closeStatus: "lost", closeReason: "lost_price",
  });
  assert.equal(closed.next, "close");
});

test("outcomes are a closed set", () => {
  const base = { notes: "Called twice.", next: "none", noNextActionReason: "Customer asked to be left alone." };
  assert.ok(completeActivitySchema.parse({ ...base, outcome: "no_answer" }));
  assert.throws(() => completeActivitySchema.parse({ ...base, outcome: "didnt pick up" }));
});

test("a manual lead can acknowledge an existing customer", () => {
  const parsed = createLeadSchema.parse({
    fullName: "Anand Iyer",
    phone: "9811024816",
    summary: "Second enquiry for the other bathroom.",
    acknowledgedDuplicateCustomerId: "6f8f1f4c-0f7a-4a4b-9e5a-1a2b3c4d5e6f",
  });
  assert.equal(parsed.acknowledgedDuplicateCustomerId, "6f8f1f4c-0f7a-4a4b-9e5a-1a2b3c4d5e6f");
});

test("calling windows are evaluated in the CRM timezone", () => {
  const windows = [{ start: "10:00", end: "13:00" }, { start: "14:00", end: "18:30" }];
  // 06:00Z is 11:30 IST — inside the morning window.
  assert.equal(withinCallingWindow(new Date("2026-08-12T06:00:00Z"), windows), true);
  // 08:00Z is 13:30 IST — the lunch gap.
  assert.equal(withinCallingWindow(new Date("2026-08-12T08:00:00Z"), windows), false);
  // 20:30Z is 02:00 IST the next day — the case the UTC date cast got wrong.
  assert.equal(withinCallingWindow(new Date("2026-08-12T20:30:00Z"), windows), false);
  assert.equal(withinCallingWindow(new Date("2026-08-12T20:30:00Z"), []), true);
});

test("customer contact preferences are honoured", () => {
  // 2026-08-12 is a Wednesday; 06:00Z is 11:30 IST.
  const instant = new Date("2026-08-12T06:00:00Z");
  assert.equal(localClock(instant).weekday, 3);
  assert.equal(withinCustomerPreference(instant, { startTime: "11:00", endTime: "13:00" }), true);
  assert.equal(withinCustomerPreference(instant, { startTime: "14:00", endTime: "18:00" }), false);
  assert.equal(withinCustomerPreference(instant, { days: [0, 6] }), false);
  assert.equal(withinCustomerPreference(instant, { days: [3] }), true);
  assert.equal(withinCustomerPreference(instant, {}), true);
});

test("search input cannot smuggle wildcards", () => {
  assert.equal(escapeLikePattern("100%"), "100\\%");
  assert.equal(escapeLikePattern("a_b"), "a\\_b");
  assert.equal(escapeLikePattern("back\\slash"), "back\\\\slash");
  assert.equal(escapeLikePattern("Kavita"), "Kavita");
});

test("activity end is derived from duration", () => {
  assert.equal(
    activityEnd("2026-08-12T06:00:00.000Z", 45).toISOString(),
    "2026-08-12T06:45:00.000Z",
  );
});
