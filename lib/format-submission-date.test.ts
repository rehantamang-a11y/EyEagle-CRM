import assert from "node:assert/strict";
import test from "node:test";
import { formatSubmissionDateIst, submissionDateKeyIst } from "./format-submission-date";

test("converts the backend UTC submission timestamp to exact IST", () => {
  assert.equal(
    formatSubmissionDateIst("2026-10-16T11:25:38.669393Z"),
    "16 Oct 2026, 4:55:38 pm IST",
  );
});

test("treats legacy zone-less backend timestamps as UTC", () => {
  assert.equal(
    formatSubmissionDateIst("2026-10-16T11:25:38.669393"),
    "16 Oct 2026, 4:55:38 pm IST",
  );
});

test("handles missing and invalid submission timestamps", () => {
  assert.equal(formatSubmissionDateIst(null), "Time not provided");
  assert.equal(formatSubmissionDateIst("not-a-date"), "Time not provided");
});

test("returns the inclusive IST calendar date used by opportunity filters", () => {
  assert.equal(submissionDateKeyIst("2026-10-16T20:00:00Z"), "2026-10-17");
  assert.equal(submissionDateKeyIst("not-a-date"), null);
});
