import assert from "node:assert/strict";
import test from "node:test";
import type { Opportunity } from "./opportunities.types";
import { buildMyWorkDashboard, buildSalesDashboard } from "./sales-dashboard";

const now = new Date(2026, 10, 16, 12);

function lead(id: string, status: string, details: Partial<Opportunity> = {}): Opportunity {
  return { id, status, fullName: id, phone: "", formAnswers: {}, submittedAt: "", ...details };
}

test("deduplicates intake and sales while keeping the claimed lead in the sales pipeline", () => {
  const sales = [
    lead("1", "UNCLAIMED"), lead("2", "DUE", { ownerName: "Asha" }),
    lead("4", "SOLD"), lead("5", "NOT_PROCEEDING"), lead("6", "CLOSED"), lead("7", "NEW_STAGE"),
  ];
  const unclaimed = [lead("1", "UNCLAIMED"), lead("2", "UNCLAIMED"), lead("3", "UNCLAIMED")];
  const dashboard = buildSalesDashboard(sales, unclaimed, now);

  assert.equal(dashboard.total, 7);
  assert.equal(dashboard.newEnquiries, 2);
  assert.equal(dashboard.intakeCount, 2);
  assert.equal(dashboard.active, 1);
  assert.equal(dashboard.inactive, 3);
  assert.equal(dashboard.otherStatus, 1);
  assert.equal(dashboard.closedOther, 1);
  assert.equal(dashboard.closeRate, 0.5);
  assert.equal(dashboard.owners.find(({ name }) => name === "Asha")?.due, 1);
});

test("groups active next actions by time without counting closed or unclaimed commitments", () => {
  const dashboard = buildSalesDashboard([
    lead("1", "FOLLOW_UP", { nextActionAt: new Date(2026, 10, 16, 11, 30).toISOString(), ownerName: "Asha" }),
    lead("2", "DUE", { nextActionAt: new Date(2026, 10, 16, 14).toISOString() }),
    lead("3", "OPEN", { nextActionAt: new Date(2026, 10, 17, 9).toISOString() }),
    lead("4", "OPEN", { nextActionAt: "invalid" }),
    lead("5", "SOLD", { nextActionAt: new Date(2026, 10, 15, 10).toISOString() }),
  ], [lead("6", "UNCLAIMED")], now);

  assert.equal(dashboard.overdue, 1);
  assert.equal(dashboard.dueToday, 1);
  assert.equal(dashboard.upcoming, 1);
  assert.equal(dashboard.unscheduled, 1);
  assert.equal(dashboard.followUps, 1);
  assert.equal(dashboard.activeUnassigned, 3);
  assert.deepEqual(dashboard.attention.map(({ id }) => id), ["1"]);
});

test("counts specific form topics once per enquiry and groups intake dates in IST", () => {
  const dashboard = buildSalesDashboard([], [
    lead("1", "UNCLAIMED", {
      submittedAt: "2026-11-09T20:00:00Z",
      source: "Website",
      formAnswers: { "What can we help with?": ["Pricing, installation or availability", "Pricing, installation or availability", "Home system"] },
    }),
    lead("2", "UNCLAIMED", {
      submittedAt: "2026-11-09T18:00:00Z",
      source: "website",
      interest: "General enquiry",
      formAnswers: { "What is your main safety concern?": ["Falls"] },
    }),
    lead("3", "UNCLAIMED"),
  ], new Date("2026-11-16T12:00:00Z"));

  assert.equal(dashboard.interested, 1);
  assert.equal(dashboard.intakeAge.buckets.at(-1)?.count, 1);
  assert.equal(dashboard.intakeAge.olderThanWeek, 1);
  assert.equal(dashboard.intakeAge.unknownDate, 1);
  assert.deepEqual(dashboard.topics, [
    { label: "Home system", count: 1 }, { label: "Pricing, installation or availability", count: 1 },
  ]);
  assert.deepEqual(dashboard.concerns, [{ label: "Falls", count: 1 }]);
  assert.deepEqual(dashboard.sources, [
    { label: "Website", count: 2 }, { label: "Source not recorded", count: 1 },
  ]);
  assert.equal(dashboard.closeRate, null);
});

test("deduplicates personal work and lists the next scheduled active actions in order", () => {
  const first = new Date(2026, 10, 16, 13).toISOString();
  const second = new Date(2026, 10, 17, 10).toISOString();
  const a = lead("a", "DUE", { nextActionAt: first, nextActionLabel: "Call customer" });
  const b = lead("b", "FOLLOW_UP", { nextActionAt: second, nextActionLabel: "Send details" });
  const closed = lead("c", "SOLD", { nextActionAt: first });
  const dashboard = buildMyWorkDashboard([b, closed, a, a], now);

  assert.equal(dashboard.total, 3);
  assert.equal(dashboard.active, 2);
  assert.equal(dashboard.sold, 1);
  assert.equal(dashboard.due, 1);
  assert.equal(dashboard.followUps, 1);
  assert.deepEqual(dashboard.scheduled.map(({ id, label }) => [id, label]), [
    ["a", "Call customer"], ["b", "Send details"],
  ]);
});
