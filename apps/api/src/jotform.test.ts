import assert from "node:assert/strict";
import test from "node:test";
import { describeJotformSubmission, mapJotformSubmission, type JotformSubmission } from "./jotform.js";

/**
 * Modelled on the actual EyEagle Home Safety Interest Form fields (fetched
 * 2026-08-03): name, phone, location, four required radio questions, an
 * optional description, and a two-part preferred contact time. Answer shapes
 * follow Jotform's documented conventions (name/phone as objects, radio/text
 * as plain strings) since this was built without live API access.
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

test("maps a complete submission into a normalized enquiry", () => {
  const mapped = mapJotformSubmission(fixture());
  assert.ok(mapped);
  assert.equal(mapped.submissionId, "6041234567890123456");
  assert.equal(mapped.enquiry.fullName, "Kavita Sharma");
  assert.equal(mapped.enquiry.phone, "9876543210");
  assert.equal(mapped.enquiry.city, "Gurugram");
  assert.equal(mapped.enquiry.priority, "urgent");
  assert.match(mapped.enquiry.summary, /Senior parent\/grandparent/);
  assert.match(mapped.enquiry.summary, /Bathroom slips or falls/);
  assert.match(mapped.enquiry.summary, /Mother slipped last month/);
  assert.match(mapped.enquiry.summary, /Book an assessment/);
  assert.match(mapped.enquiry.summary, /This weekend, Morning/);
  assert.deepEqual(mapped.unmapped, []);
});

test("no immediate concern maps to normal priority", () => {
  const mapped = mapJotformSubmission(fixture({
    answers: { "6": { text: "Any immediate safety concern?", type: "control_radio", answer: "No" } },
  }));
  assert.equal(mapped?.enquiry.priority, "normal");
});

test("site/location does not get mistaken for the name field", () => {
  // Both labels contain the substring "name" ("Your Name" vs "Site name or
  // location"), which is exactly the kind of collision naive matching would get
  // wrong.
  const mapped = mapJotformSubmission(fixture());
  assert.equal(mapped?.enquiry.fullName, "Kavita Sharma");
  assert.equal(mapped?.enquiry.city, "Gurugram");
});

test("main concern and immediate concern do not get swapped", () => {
  // Both labels contain "safety concern"; only "main" vs "immediate" disambiguates.
  const mapped = mapJotformSubmission(fixture());
  assert.match(mapped?.enquiry.summary ?? "", /Main concern: Bathroom slips or falls/);
  assert.match(mapped?.enquiry.summary ?? "", /Immediate concern: Yes/);
});

test("missing name or phone rejects the submission instead of guessing", () => {
  assert.equal(mapJotformSubmission(fixture({ answers: { "1": { text: "Your Name", answer: "" } } })), null);
  assert.equal(mapJotformSubmission(fixture({ answers: { "2": { text: "Phone Number / Whatsapp No.", answer: "" } } })), null);
});

test("a renamed optional question is reported as unmapped rather than crashing", () => {
  const mapped = mapJotformSubmission(fixture({
    answers: { "8": { text: "Anything else you would like to tell us?", type: "control_radio", answer: "Book an assessment" } },
  }));
  assert.ok(mapped);
  assert.ok(mapped.unmapped.includes("nextStep"));
  assert.doesNotMatch(mapped.enquiry.summary, /Wants:/);
});

test("a string-shaped phone answer (no nested object) still normalizes", () => {
  const mapped = mapJotformSubmission(fixture({
    answers: { "2": { text: "Phone Number / Whatsapp No.", type: "control_phone", answer: "98765 43210" } },
  }));
  assert.equal(mapped?.enquiry.phone, "98765 43210");
});

test("describeJotformSubmission preserves each original answer as its own field", () => {
  // This is the display counterpart to mapJotformSubmission: an operator should
  // see exactly what the customer selected, not the paraphrased summary sentence
  // that gets stored on the lead for search and the pipeline card.
  const context = describeJotformSubmission(fixture());
  assert.equal(context.consideringFor, "Senior parent/grandparent - same home");
  assert.equal(context.mainConcern, "Bathroom slips or falls");
  assert.equal(context.immediateConcern, true);
  assert.equal(context.immediateConcernRaw, "Yes");
  assert.equal(context.description, "Mother slipped last month.");
  assert.equal(context.location, "Gurugram");
  assert.equal(context.interestedIn, "Book an assessment");
  assert.equal(context.preferredDay, "This weekend");
  assert.equal(context.preferredTiming, "Morning");
  assert.deepEqual(context.unmapped, []);
});

test("describeJotformSubmission treats No and blank as not immediate", () => {
  const no = describeJotformSubmission(fixture({
    answers: { "6": { text: "Any immediate safety concern?", type: "control_radio", answer: "No" } },
  }));
  assert.equal(no.immediateConcern, false);

  const blank = describeJotformSubmission(fixture({
    answers: { "6": { text: "Any immediate safety concern?", type: "control_radio", answer: "" } },
  }));
  assert.equal(blank.immediateConcern, false);
  assert.equal(blank.immediateConcernRaw, undefined);
});

test("describeJotformSubmission reports unmapped fields instead of guessing", () => {
  const context = describeJotformSubmission(fixture({
    answers: { "5": { text: "What's bothering you most?", type: "control_radio", answer: "Falls" } },
  }));
  assert.equal(context.mainConcern, undefined);
  assert.ok(context.unmapped.includes("mainConcern"));
});
