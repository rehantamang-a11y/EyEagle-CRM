import assert from "node:assert/strict";
import test from "node:test";
import { crmListHref, parseSalesFilter, safeNextPath } from "./crm-routes";

test("normalizes supported sales filters and falls back to ALL", () => {
  assert.equal(parseSalesFilter("FOLLOW_UPS"), "FOLLOW_UPS");
  assert.equal(parseSalesFilter("closed"), "CLOSED");
  assert.equal(parseSalesFilter("unknown"), "ALL");
  assert.equal(parseSalesFilter(null), "ALL");
});

test("builds canonical list URLs with encoded search parameters", () => {
  assert.equal(crmListHref("new-enquiries"), "/new-enquiries");
  assert.equal(crmListHref("my-work", "DUE", "Kavita Sharma"), "/my-work?filter=DUE&q=Kavita+Sharma");
  assert.equal(crmListHref("all-sales", "ALL", "+91 98111 22334"), "/all-sales?filter=ALL&q=%2B91+98111+22334");
});

test("accepts only same-origin relative login return paths", () => {
  assert.equal(safeNextPath("/my-work?filter=CLOSED"), "/my-work?filter=CLOSED");
  assert.equal(safeNextPath("//example.com"), "/new-enquiries");
  assert.equal(safeNextPath("https://example.com"), "/new-enquiries");
});
