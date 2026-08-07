import assert from "node:assert/strict";
import test from "node:test";
import { sortOpportunitiesLatestFirst } from "./opportunity-sort";
import type { Opportunity } from "./opportunities.types";

const opportunity = (
  id: string,
  dates: Pick<Opportunity, "submittedAt" | "lastActionAt">,
): Opportunity => ({
  id,
  status: "OPEN",
  fullName: id,
  phone: "Phone not provided",
  formAnswers: {},
  ...dates,
});

test("sorts New Inquiries by submittedAt newest first without mutating query data", () => {
  const rows = [
    opportunity("older", { submittedAt: "2026-08-05T10:00:00" }),
    opportunity("newest", { submittedAt: "2026-08-07T10:00:00" }),
    opportunity("middle", { submittedAt: "2026-08-06T10:00:00" }),
  ];

  const sorted = sortOpportunitiesLatestFirst(rows, "submittedAt");

  assert.deepEqual(sorted.map(({ id }) => id), ["newest", "middle", "older"]);
  assert.deepEqual(rows.map(({ id }) => id), ["older", "newest", "middle"]);
});

test("sorts compact table rows by lastUpdatedAt normalization and places missing dates last", () => {
  const rows = [
    opportunity("missing", { submittedAt: "", lastActionAt: null }),
    opportunity("older", { submittedAt: "", lastActionAt: "2026-08-05T10:00:00" }),
    opportunity("invalid", { submittedAt: "", lastActionAt: "not-a-date" }),
    opportunity("newest", { submittedAt: "", lastActionAt: "2026-08-07T10:00:00" }),
  ];

  const sorted = sortOpportunitiesLatestFirst(rows, "lastActionAt");

  assert.deepEqual(sorted.map(({ id }) => id), ["newest", "older", "missing", "invalid"]);
});
