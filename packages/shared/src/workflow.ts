import { z } from "zod";

export const interactionChannels = ["call", "whatsapp", "email", "meeting", "note"] as const;
export const contactResults = ["reached", "no_answer", "wrong_number"] as const;
export const lostReasons = ["not_interested", "price", "chose_alternative", "unreachable", "invalid_contact", "outside_service_area", "duplicate", "other"] as const;

const interactionNextStepSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("schedule_follow_up"), scheduledStart: z.string().datetime(), title: z.string().trim().min(2).max(160).default("Customer follow-up") }),
  z.object({ type: z.literal("confirm_audit_date"), scheduledStart: z.string().datetime() }),
  z.object({ type: z.literal("confirm_audit"), scheduledStart: z.string().datetime(), durationMinutes: z.number().int().min(30).max(240).default(60), address: z.string().trim().min(5).max(500), context: z.string().trim().max(2000).optional(), customerConfirmed: z.literal(true) }),
  z.object({ type: z.literal("send_purchase_link"), purchaseLinkId: z.string().uuid(), channel: z.enum(["whatsapp", "email", "sms", "other"]), reviewAt: z.string().datetime() }),
  z.object({ type: z.literal("snooze"), reviewAt: z.string().datetime(), reason: z.string().trim().min(2).max(1000) }),
  z.object({ type: z.literal("not_proceeding"), reason: z.enum(lostReasons), note: z.string().trim().max(2000).optional() }),
  z.object({ type: z.literal("do_not_contact"), reason: z.enum(lostReasons), note: z.string().trim().max(2000).optional() }),
  z.object({ type: z.literal("mark_sold"), confirmationNote: z.string().trim().min(2).max(2000) }),
  z.object({ type: z.literal("update_number"), phone: z.string().trim().min(8).max(24), scheduledStart: z.string().datetime() }),
]);

export const interactionSchema = z.object({
  channel: z.enum(interactionChannels),
  contactResult: z.enum(contactResults),
  notes: z.string().trim().min(2).max(4000),
  nextStep: interactionNextStepSchema,
}).superRefine((value, context) => {
  const type = value.nextStep.type;
  if (value.contactResult === "reached" && type === "update_number") context.addIssue({ code: z.ZodIssueCode.custom, path: ["nextStep"], message: "Reached customers need a sales next step." });
  if (value.contactResult === "no_answer" && !["schedule_follow_up", "snooze", "not_proceeding"].includes(type)) context.addIssue({ code: z.ZodIssueCode.custom, path: ["nextStep"], message: "No-answer interactions require a retry, snooze, or closure." });
  if (value.contactResult === "wrong_number" && !["update_number", "not_proceeding"].includes(type)) context.addIssue({ code: z.ZodIssueCode.custom, path: ["nextStep"], message: "Wrong-number interactions require an updated number or invalid-contact closure." });
});

export const claimOpportunitySchema = z.object({}).default({});

export const followUpSchema = z.object({
  scheduledStart: z.string().datetime(),
  title: z.string().trim().min(2).max(160).default("Customer follow-up"),
  type: z.enum(["call", "whatsapp", "email", "general_task"]).default("call"),
  durationMinutes: z.number().int().min(5).max(120).default(15),
  notes: z.string().trim().max(2000).optional(),
});

export const auditAppointmentSchema = z.object({
  scheduledStart: z.string().datetime(),
  durationMinutes: z.number().int().min(30).max(240).default(60),
  address: z.string().trim().min(5).max(500),
  context: z.string().trim().max(2000).optional(),
  customerConfirmed: z.literal(true),
});

export const updateAuditAppointmentSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("reschedule"), scheduledStart: z.string().datetime(), durationMinutes: z.number().int().min(30).max(240).default(60), reason: z.string().trim().min(2).max(500), customerConfirmed: z.literal(true) }),
  z.object({ action: z.literal("cancel"), reason: z.string().trim().min(2).max(500), nextActionAt: z.string().datetime() }),
]);

export const sendPurchaseLinkSchema = z.object({
  purchaseLinkId: z.string().uuid(),
  channel: z.enum(["whatsapp", "email", "sms", "other"]),
  reviewAt: z.string().datetime(),
  note: z.string().trim().max(2000).optional(),
});

export const snoozeOpportunitySchema = z.object({
  reviewAt: z.string().datetime(),
  reason: z.string().trim().min(2).max(1000),
});

export const closeLostSchema = z.object({
  reason: z.enum(lostReasons),
  note: z.string().trim().max(2000).optional(),
  doNotContact: z.boolean().default(false),
});

export const markSoldSchema = z.object({ confirmationNote: z.string().trim().min(2).max(2000) });
export const reopenOpportunitySchema = z.object({ reason: z.string().trim().min(2).max(1000), nextActionAt: z.string().datetime() });
export const transferOpportunitySchema = z.object({ newOwnerUserId: z.string().uuid(), reason: z.string().trim().min(2).max(500), note: z.string().trim().max(2000).optional() });

export const purchaseLinkSchema = z.object({ name: z.string().trim().min(2).max(120), url: z.string().url(), description: z.string().trim().max(500).optional() });

export function nextWorkingDayAfter(value: string | Date): Date {
  const base = new Date(value);
  const dateParts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(base).split("-").map(Number);
  const cursor = new Date(Date.UTC(dateParts[0], dateParts[1] - 1, dateParts[2] + 1, 5, 0));
  while (cursor.getUTCDay() === 0) cursor.setUTCDate(cursor.getUTCDate() + 1);
  return cursor;
}

type JotformAnswer = { answer?: unknown; prettyFormat?: string; text?: string };
export type JotformSubmission = { id: string; form_id: string; created_at: string; status?: string; answers?: Record<string, JotformAnswer> };
type JotformFieldReference = string | string[];
export type JotformFieldMap = {
  fullName: string; phone: string; email?: string; city?: string; summary?: JotformFieldReference; preferredContactTime?: JotformFieldReference;
  consideringFor?: string; safetyConcerns?: string; immediateSafetyConcern?: string; expressedInterest?: string; requestedNextStep?: string; preferredContactDay?: string; preferredContactPeriod?: string;
};

function answerText(answer: JotformAnswer | undefined): string {
  if (!answer) return "";
  if (typeof answer.prettyFormat === "string") return answer.prettyFormat.trim();
  if (typeof answer.answer === "string" || typeof answer.answer === "number") return String(answer.answer).trim();
  if (answer.answer && typeof answer.answer === "object") return Object.values(answer.answer as Record<string, unknown>).filter(Boolean).join(" ").trim();
  return "";
}

function answerValues(answer: JotformAnswer | undefined): string[] {
  if (!answer?.answer) return [];
  if (Array.isArray(answer.answer)) return answer.answer.map(String).map((value) => value.trim()).filter(Boolean);
  if (typeof answer.answer === "object") return Object.values(answer.answer as Record<string, unknown>).map(String).map((value) => value.trim()).filter(Boolean);
  const value = String(answer.answer).trim();
  return value ? [value] : [];
}

export function mapJotformSubmission(submission: JotformSubmission, map: JotformFieldMap) {
  const field = (id?: string) => id ? answerText(submission.answers?.[id]) : "";
  const fields = (reference?: JotformFieldReference) => (Array.isArray(reference) ? reference : reference ? [reference] : []).map(field).filter(Boolean).join(" · ");
  return {
    fullName: field(map.fullName),
    phone: field(map.phone),
    email: field(map.email),
    city: field(map.city),
    summary: fields(map.summary) || "Jotform enquiry",
    preferredContactTime: fields(map.preferredContactTime),
    consideringFor: map.consideringFor ? answerValues(submission.answers?.[map.consideringFor]) : [],
    safetyConcerns: map.safetyConcerns ? answerValues(submission.answers?.[map.safetyConcerns]) : [],
    immediateSafetyConcern: map.immediateSafetyConcern ? field(map.immediateSafetyConcern).toLowerCase() === "yes" : false,
    expressedInterest: field(map.expressedInterest || map.requestedNextStep),
    preferredContactDay: field(map.preferredContactDay),
    preferredContactPeriod: field(map.preferredContactPeriod),
    submittedAt: new Date(submission.created_at.replace(" ", "T") + (submission.created_at.includes("Z") ? "" : "Z")).toISOString(),
    source: "Jotform",
    priority: "normal" as const,
  };
}
