import assert from "node:assert/strict";
import test from "node:test";
import { defaultReminderMinutes, normalizeIndianPhone, rangesConflict } from "./index.js";

test("normalizes common Indian phone formats", () => {
  assert.equal(normalizeIndianPhone("98765 43210"), "+919876543210");
  assert.equal(normalizeIndianPhone("09876543210"), "+919876543210");
  assert.equal(normalizeIndianPhone("+91-98765-43210"), "+919876543210");
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
