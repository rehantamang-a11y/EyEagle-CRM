import assert from "node:assert/strict";
import test from "node:test";
import { auditAppointmentSchema, claimOpportunitySchema, interactionSchema, mapJotformSubmission, nextWorkingDayAfter } from "./workflow.js";

test("next working day skips Sunday and uses the India workday start", () => {
  assert.equal(nextWorkingDayAfter("2026-08-01T10:00:00.000Z").toISOString(), "2026-08-03T05:00:00.000Z");
  assert.equal(nextWorkingDayAfter("2026-08-03T10:00:00.000Z").toISOString(), "2026-08-04T05:00:00.000Z");
});

test("claiming only changes ownership and needs no call action", () => {
  assert.equal(claimOpportunitySchema.safeParse(undefined).success, true);
  assert.equal(claimOpportunitySchema.safeParse({}).success, true);
});

test("audit interest stays a follow-up until the customer confirms an appointment", () => {
  const pending = interactionSchema.safeParse({ channel: "call", contactResult: "reached", notes: "Customer wants to check with family.", nextStep: { type: "confirm_audit_date", scheduledStart: "2026-08-03T05:30:00.000Z" } });
  assert.equal(pending.success, true);
  assert.equal(auditAppointmentSchema.safeParse({ scheduledStart: "2026-08-05T05:30:00.000Z", durationMinutes: 60, address: "12 Example Road, Delhi" }).success, false);
  assert.equal(auditAppointmentSchema.safeParse({ scheduledStart: "2026-08-05T05:30:00.000Z", durationMinutes: 60, address: "12 Example Road, Delhi", customerConfirmed: true }).success, true);
});

test("maps stable Jotform question ids without retaining the raw response", () => {
  const mapped = mapJotformSubmission({ id:"sub-1", form_id:"form-1", created_at:"2026-08-02 10:00:00", answers:{ "3":{answer:{first:"Kavita",last:"Sharma"}}, "4":{answer:"9876543210"}, "5":{answer:"Needs an audit"}, "11":{answer:"Yes"}, "21":{answer:["Senior parent at home"]}, "22":{answer:["Bathroom slips or falls"]}, "23":{answer:"Book a bathroom safety assessment"}, "24":{answer:"Tomorrow"}, "25":{answer:"Morning"} } }, { fullName:"3", phone:"4", summary:"5", immediateSafetyConcern:"11", consideringFor:"21", safetyConcerns:"22", expressedInterest:"23", preferredContactDay:"24", preferredContactPeriod:"25" });
  assert.equal(mapped.fullName, "Kavita Sharma");
  assert.equal(mapped.phone, "9876543210");
  assert.equal(mapped.summary, "Needs an audit");
  assert.equal(mapped.expressedInterest, "Book a bathroom safety assessment");
  assert.deepEqual(mapped.consideringFor, ["Senior parent at home"]);
  assert.deepEqual(mapped.safetyConcerns, ["Bathroom slips or falls"]);
  assert.equal(mapped.immediateSafetyConcern, true);
  assert.equal(mapped.submittedAt, "2026-08-02T10:00:00.000Z");
  assert.equal(mapped.preferredContactTime, "");
  assert.equal(mapped.preferredContactDay, "Tomorrow");
  assert.equal(mapped.preferredContactPeriod, "Morning");
});
