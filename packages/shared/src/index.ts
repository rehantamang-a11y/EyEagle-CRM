import { z } from "zod";

export const CRM_TIMEZONE = "Asia/Kolkata";
export const OPEN_LEAD_STATUSES = ["unclaimed", "active"] as const;
export const leadPriorities = ["urgent", "high", "normal", "low"] as const;
export const activityTypes = [
  "call", "whatsapp", "email", "meeting", "home_visit", "bathroom_audit",
  "send_proposal", "payment_follow_up", "installation_follow_up", "general_task",
] as const;

/**
 * Outcomes are a closed set so connect rate, drop-off by stage and
 * outcome-driven automation stay computable. Free text made those impossible.
 */
export const activityOutcomes = [
  "connected", "no_answer", "busy", "wrong_number", "unreachable",
  "interested", "not_interested", "callback_requested",
  "visit_scheduled", "audit_completed", "proposal_shared", "payment_received",
  "rescheduled_by_customer", "other",
] as const;

export const wonCloseReasons = ["won_installed", "won_paid"] as const;
export const lostCloseReasons = [
  "lost_price", "lost_no_response", "lost_competitor",
  "lost_not_ready", "lost_not_qualified", "lost_other",
] as const;
export const leadCloseReasons = [...wonCloseReasons, ...lostCloseReasons, "duplicate"] as const;

export const reminderChannels = ["in_app", "email"] as const;
export const MAX_REMINDER_LEAD_MINUTES = 10_080; // one week

export type ActivityType = typeof activityTypes[number];
export type ActivityOutcome = typeof activityOutcomes[number];
export type LeadCloseReason = typeof leadCloseReasons[number];

export const websiteIntakeSchema = z.object({
  fullName: z.string().trim().min(2).max(120),
  phone: z.string().trim().min(8).max(24),
  email: z.string().email().optional().or(z.literal("")),
  city: z.string().trim().max(100).optional(),
  summary: z.string().trim().min(3).max(2000),
  preferredContactTime: z.string().trim().max(120).optional(),
  source: z.string().trim().max(80).default("Website"),
  priority: z.enum(leadPriorities).default("normal"),
});

export const createLeadSchema = websiteIntakeSchema.extend({
  assignToSelf: z.boolean().default(false),
  /** Set after an operator reviews a phone-number match and confirms it is a different person. */
  acknowledgedDuplicateCustomerId: z.string().uuid().optional(),
});

/**
 * Zero is a valid lead time — it means "remind me exactly when this starts" —
 * so this is nonnegative rather than positive. The previous `positive()` rejected
 * the library's own defaults for email, proposal and task activities.
 */
const reminderMinutesSchema = z.array(z.number().int().nonnegative().max(MAX_REMINDER_LEAD_MINUTES))
  .max(6)
  .transform((values) => [...new Set(values)].sort((first, second) => second - first));

export const scheduleActivitySchema = z.object({
  leadId: z.string().uuid(),
  type: z.enum(activityTypes),
  title: z.string().trim().min(2).max(160),
  scheduledStart: z.string().datetime(),
  durationMinutes: z.number().int().min(5).max(480),
  reminderMinutes: reminderMinutesSchema.default([]),
  notes: z.string().trim().max(2000).optional(),
  overrideConflictReason: z.string().trim().min(3).max(500).optional(),
  /** Acknowledges a calling-window or customer-preference warning rather than a hard conflict. */
  overrideWindowReason: z.string().trim().min(3).max(500).optional(),
});

/** The follow-up part of a completion fork, minus the lead id, which is implied. */
export const followUpSchema = scheduleActivitySchema.omit({ leadId: true });

/**
 * Completing an activity is the moment the follow-up chain is kept or broken, so
 * the caller must say which. `none` is allowed but must be justified and is
 * attributed to the operator who chose it.
 */
export const completeActivitySchema = z.object({
  outcome: z.enum(activityOutcomes),
  notes: z.string().trim().min(2).max(4000),
  nextStageId: z.string().uuid().optional(),
}).and(z.discriminatedUnion("next", [
  z.object({ next: z.literal("schedule"), followUp: followUpSchema }),
  z.object({
    next: z.literal("close"),
    closeStatus: z.enum(["won", "lost"]),
    closeReason: z.enum(leadCloseReasons),
  }),
  z.object({
    next: z.literal("none"),
    noNextActionReason: z.string().trim().min(10).max(500),
  }),
]));

export const transitionStageSchema = z.object({
  stageId: z.string().uuid(),
  reason: z.string().trim().max(500).optional(),
  expectedVersion: z.number().int().positive().optional(),
});

export const closeLeadSchema = z.object({
  status: z.enum(["won", "lost"]),
  closeReason: z.enum(leadCloseReasons),
  notes: z.string().trim().max(2000).optional(),
  expectedVersion: z.number().int().positive().optional(),
});

export const reopenLeadSchema = z.object({
  reason: z.string().trim().min(3).max(500),
  expectedVersion: z.number().int().positive().optional(),
});

export const createNoteSchema = z.object({
  content: z.string().trim().min(1).max(4000),
  noteType: z.enum(["general", "call_summary", "requirement", "objection", "internal"]).default("general"),
});

export const updateCustomerSchema = z.object({
  fullName: z.string().trim().min(2).max(120).optional(),
  email: z.string().email().optional().or(z.literal("")),
  city: z.string().trim().max(100).optional(),
  address: z.string().trim().max(500).optional(),
  alternatePhone: z.string().trim().max(24).optional(),
  preferredContactMethod: z.enum(["call", "whatsapp", "email"]).optional(),
  preferredContactStartTime: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  preferredContactEndTime: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  preferredContactDays: z.array(z.number().int().min(0).max(6)).max(7).optional(),
  contactNotes: z.string().trim().max(2000).optional(),
  expectedVersion: z.number().int().positive().optional(),
});

export const setDoNotContactSchema = z.object({
  doNotContact: z.boolean(),
  reason: z.string().trim().min(3).max(500),
});

export const rescheduleActivitySchema = z.object({
  scheduledStart: z.string().datetime(),
  durationMinutes: z.number().int().min(5).max(480),
  reason: z.string().trim().min(3).max(500),
  reminderMinutes: reminderMinutesSchema.optional(),
  overrideConflictReason: z.string().trim().min(3).max(500).optional(),
});

export const cancelActivitySchema = z.object({
  reason: z.string().trim().min(3).max(500),
});

export const updateReminderChannelsSchema = z.object({
  reminderChannels: z.array(z.enum(reminderChannels)).max(reminderChannels.length),
});

export type WebsiteIntake = z.infer<typeof websiteIntakeSchema>;
export type ScheduleActivity = z.infer<typeof scheduleActivitySchema>;
export type CompleteActivity = z.infer<typeof completeActivitySchema>;

export function normalizeIndianPhone(input: string): string {
  const digits = input.replace(/\D/g, "");
  if (digits.length === 10) return `+91${digits}`;
  if (digits.length === 11 && digits.startsWith("0")) return `+91${digits.slice(1)}`;
  if (digits.length === 12 && digits.startsWith("91")) return `+${digits}`;
  return input.trim().startsWith("+") ? `+${digits}` : digits;
}

export function activityEnd(start: string | Date, durationMinutes: number): Date {
  return new Date(new Date(start).getTime() + durationMinutes * 60_000);
}

export function rangesConflict(
  firstStart: Date,
  firstEnd: Date,
  secondStart: Date,
  secondEnd: Date,
  bufferMinutes = 0,
): boolean {
  const buffer = bufferMinutes * 60_000;
  return firstStart.getTime() < secondEnd.getTime() + buffer &&
    firstEnd.getTime() + buffer > secondStart.getTime();
}

export function defaultReminderMinutes(type: ActivityType): number[] {
  if (["meeting", "home_visit", "bathroom_audit"].includes(type)) return [1440, 120, 30];
  if (["call", "whatsapp"].includes(type)) return [1440, 30];
  return [0];
}

/** Buffer applied between two of an operator's activities, by the type being scheduled. */
export function bufferMinutesFor(type: ActivityType): number {
  if (["meeting", "home_visit", "bathroom_audit"].includes(type)) return 15;
  return 5;
}

export type CallingWindow = { start: string; end: string };

const minutesFromClock = (clock: string): number => {
  const [hours, minutes] = clock.split(":").map(Number);
  return hours * 60 + minutes;
};

/** Wall-clock minutes since midnight for `instant` in `timeZone`, plus the weekday. */
export function localClock(instant: Date, timeZone = CRM_TIMEZONE): { minutes: number; weekday: number } {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone, hour: "2-digit", minute: "2-digit", weekday: "short", hour12: false,
  }).formatToParts(instant);
  const value = (type: string) => parts.find((part) => part.type === type)?.value ?? "0";
  const weekdays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  return {
    minutes: Number(value("hour")) * 60 + Number(value("minute")),
    weekday: Math.max(0, weekdays.indexOf(value("weekday"))),
  };
}

/**
 * The schema, the settings screen and the customer record all described calling
 * windows and preferred contact times that nothing ever checked. This is the
 * check; callers surface it as a warning an operator can override, not a block.
 */
export function withinCallingWindow(
  start: Date,
  windows: CallingWindow[],
  timeZone = CRM_TIMEZONE,
): boolean {
  if (!windows.length) return true;
  const { minutes } = localClock(start, timeZone);
  return windows.some((window) => minutes >= minutesFromClock(window.start) && minutes < minutesFromClock(window.end));
}

export function withinCustomerPreference(
  start: Date,
  preference: { startTime?: string | null; endTime?: string | null; days?: number[] | null },
  timeZone = CRM_TIMEZONE,
): boolean {
  const { minutes, weekday } = localClock(start, timeZone);
  if (preference.days?.length && !preference.days.includes(weekday)) return false;
  if (preference.startTime && minutes < minutesFromClock(preference.startTime)) return false;
  if (preference.endTime && minutes >= minutesFromClock(preference.endTime)) return false;
  return true;
}

/**
 * `%` and `_` in operator search input would otherwise act as wildcards and
 * quietly match far more than intended.
 */
export function escapeLikePattern(input: string): string {
  return input.replace(/[\\%_]/g, (match) => `\\${match}`);
}
