import assert from "node:assert/strict";
import test from "node:test";
import { formatSubmissionDateUtc, submissionDateKeyIst } from "./format-submission-date";

test("formats backend timestamps as exact UTC", () => {
  assert.equal(
    formatSubmissionDateUtc("2026-10-16T11:25:38.669393Z"),
    "16 Oct 2026, 11:25:38 am",
  );
});

test("treats legacy zone-less backend timestamps as UTC", () => {
  assert.equal(
    formatSubmissionDateUtc("2026-10-16T11:25:38.669393"),
    "16 Oct 2026, 11:25:38 am",
  );
});

test("handles missing and invalid submission timestamps", () => {
  assert.equal(formatSubmissionDateUtc(null), "Time not provided");
  assert.equal(formatSubmissionDateUtc("not-a-date"), "Time not provided");
});

test("returns the inclusive IST calendar date used by opportunity filters", () => {
  assert.equal(submissionDateKeyIst("2026-10-16T20:00:00Z"), "2026-10-17");
  assert.equal(submissionDateKeyIst("not-a-date"), null);
});
