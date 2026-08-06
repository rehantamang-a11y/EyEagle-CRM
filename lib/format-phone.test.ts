import assert from "node:assert/strict";
import test from "node:test";
import { formatIndianPhone } from "./format-phone";

test("formats common Indian phone representations consistently", () => {
  assert.equal(formatIndianPhone("(987) 169-5173"), "+91 98716 95173");
  assert.equal(formatIndianPhone("+91 98716 95173"), "+91 98716 95173");
  assert.equal(formatIndianPhone("09871695173"), "+91 98716 95173");
});

test("preserves values that are not ten-digit Indian numbers", () => {
  assert.equal(formatIndianPhone("12345"), "12345");
  assert.equal(formatIndianPhone(null), "Phone not provided");
});
