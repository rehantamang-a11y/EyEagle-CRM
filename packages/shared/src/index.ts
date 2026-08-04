import { z } from "zod";

export const CRM_TIMEZONE = "Asia/Kolkata";
export const OPEN_LEAD_STATUSES = ["unclaimed", "active"] as const;
export const leadPriorities = ["urgent", "high", "normal", "low"] as const;
export const activityTypes = [
  "call", "whatsapp", "email", "meeting", "home_visit", "bathroom_audit",
  "send_proposal", "payment_follow_up", "installation_follow_up", "general_task",
] as const;

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
});

export const scheduleActivitySchema = z.object({
  leadId: z.string().uuid(),
  type: z.enum(activityTypes),
  title: z.string().trim().min(2).max(160),
  scheduledStart: z.string().datetime(),
  durationMinutes: z.number().int().min(5).max(480),
  reminderMinutes: z.array(z.number().int().positive()).default([]),
  notes: z.string().trim().max(2000).optional(),
  overrideConflictReason: z.string().trim().min(3).max(500).optional(),
});

export const completeActivitySchema = z.object({
  outcome: z.string().trim().min(2).max(100),
  notes: z.string().trim().min(2).max(4000),
  nextStageId: z.string().uuid().optional(),
  noNextActionReason: z.string().trim().min(3).max(500).optional(),
});

export type WebsiteIntake = z.infer<typeof websiteIntakeSchema>;
export type ScheduleActivity = z.infer<typeof scheduleActivitySchema>;

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

export function defaultReminderMinutes(type: typeof activityTypes[number]): number[] {
  if (["meeting", "home_visit", "bathroom_audit"].includes(type)) return [1440, 120, 30];
  if (["call", "whatsapp"].includes(type)) return [1440, 30];
  return [0];
}
