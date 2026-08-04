import assert from "node:assert/strict";
import test from "node:test";
import { mapJotformSubmission, type JotformSubmission } from "./jotform.js";

/**
 * Modelled on the EyEagle Home Safety Interest Form: name, phone, location,
 * four required radio questions, an optional description, and a two-part
 * preferred contact time. Answer shapes follow Jotform's documented
 * conventions (name/phone as objects, radio/text as plain strings).
 */
function fixture(overrides: Partial<Record<string, unknown>> = {}): JotformSubmission {
  const answers: JotformSubmission["answers"] = {
    "1": { text: "Your Name", type: "control_fullname", answer: { first: "Kavita", last: "Sharma" } },
    "2": { text: "Phone Number / Whatsapp No.", type: "control_phone", answer: { phone: "9876543210" } },
    "3": { text: "Site name or location", type: "control_textbox", answer: "Gurugram" },
    "4": { text: "Who are you considering EyEagle for?", type: "control_radio", answer: "Senior parent/grandparent - same home" },
    "5": { text: "What is your main safety concern?", type: "control_radio", answer: "Bathroom slips or falls" },
    "6": { text: "Any immediate safety concern?", type: "control_radio", answer: "Yes" },
    "7": { text: "Briefly describe your concern", type: "control_textarea", answer: "Mother slipped last month." },
    "8": { text: "What would you like next?", type: "control_radio", answer: "Book an assessment" },
    "9": { text: "Preferred time to contact", type: "control_radio", answer: "This weekend" },
    "10": { text: "Timings", type: "control_radio", answer: "Morning" },
  };
  return {
    id: "6041234567890123456",
    form_id: "240123456789012",
    created_at: "2026-08-03 09:15:00",
    answers: { ...answers, ...(overrides.answers as typeof answers | undefined) },
  };
}

test("maps a complete submission into an unclaimed-opportunity-ready shape", () => {
  const mapped = mapJotformSubmission(fixture());
  assert.ok(mapped);
  assert.equal(mapped.fullName, "Kavita Sharma");
  assert.equal(mapped.phone, "9876543210");
  assert.equal(mapped.city, "Gurugram");
  assert.equal(mapped.priority, "urgent");
  assert.equal(mapped.immediateConcern, true);
  assert.match(mapped.summary, /Senior parent\/grandparent/);
  assert.match(mapped.summary, /Bathroom slips or falls/);
  assert.match(mapped.summary, /Mother slipped last month/);
  assert.match(mapped.summary, /Interested in: Book an assessment/);
  assert.match(mapped.summary, /Preferred callback: This weekend, Morning/);
  assert.deepEqual(mapped.unmapped, []);
});

test("interested-in-assessment reads as expressed interest, never a commitment", () => {
  // system-guide.md: "Interested in a bathroom assessment means the customer
  // expressed interest; it does not mean an assessment is scheduled." The
  // summary text must not claim an audit/assessment already exists.
  const mapped = mapJotformSubmission(fixture());
  assert.match(mapped?.summary ?? "", /Interested in:/);
  assert.doesNotMatch(mapped?.summary ?? "", /scheduled|confirmed|booked audit/i);
});

test("no immediate concern maps to normal priority, not urgent", () => {
  const mapped = mapJotformSubmission(fixture({
    answers: { "6": { text: "Any immediate safety concern?", type: "control_radio", answer: "No" } },
  }));
  assert.equal(mapped?.priority, "normal");
  assert.equal(mapped?.immediateConcern, false);
});

test("site/location does not get mistaken for the name field", () => {
  // Both labels contain "name" ("Your Name" vs "Site name or location") —
  // exactly the collision naive substring matching would get wrong.
  const mapped = mapJotformSubmission(fixture());
  assert.equal(mapped?.fullName, "Kavita Sharma");
  assert.equal(mapped?.city, "Gurugram");
});

test("main concern and immediate concern do not get swapped", () => {
  // Both labels contain "safety concern"; only "main" vs "immediate" disambiguates.
  const mapped = mapJotformSubmission(fixture());
  assert.match(mapped?.summary ?? "", /Main concern: Bathroom slips or falls/);
  assert.match(mapped?.summary ?? "", /Immediate concern: Yes/);
});

test("missing name or phone returns null so the submission is held for review, not guessed", () => {
  assert.equal(mapJotformSubmission(fixture({ answers: { "1": { text: "Your Name", answer: "" } } })), null);
  assert.equal(mapJotformSubmission(fixture({ answers: { "2": { text: "Phone Number / Whatsapp No.", answer: "" } } })), null);
});

test("a renamed optional question is reported as unmapped rather than blocking the submission", () => {
  const mapped = mapJotformSubmission(fixture({
    answers: { "8": { text: "Anything else you would like to tell us?", type: "control_radio", answer: "Book an assessment" } },
  }));
  assert.ok(mapped, "still creates an opportunity even with an unmapped optional field");
  assert.ok(mapped.unmapped.includes("interestedIn"));
  assert.doesNotMatch(mapped.summary, /Interested in:/);
});

test("a string-shaped phone answer (no nested object) still normalizes", () => {
  const mapped = mapJotformSubmission(fixture({
    answers: { "2": { text: "Phone Number / Whatsapp No.", type: "control_phone", answer: "98765 43210" } },
  }));
  assert.equal(mapped?.phone, "98765 43210");
});
