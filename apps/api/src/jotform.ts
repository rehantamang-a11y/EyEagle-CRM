import type { leadPriorities } from "@eyeagle/crm-shared";

export type JotformAnswer = {
  name?: string;
  text?: string;
  type?: string;
  answer?: unknown;
  prettyFormat?: string;
};

export type JotformSubmission = {
  id: string;
  form_id: string;
  created_at: string;
  answers: Record<string, JotformAnswer>;
};

export type MappedJotformSubmission = {
  fullName: string;
  phone: string;
  city?: string;
  summary: string;
  priority: typeof leadPriorities[number];
  immediateConcern: boolean;
  /** Expected questions that could not be matched, e.g. after the form was edited. Never blocks creation. */
  unmapped: string[];
};

const normalizeLabel = (text: string): string =>
  text.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, "").replace(/\s+/g, " ").trim();

/**
 * Answer values vary by Jotform control type: plain strings, {first,last} name
 * objects, {full,area,phone} phone objects, or arrays for checkboxes. This
 * flattens any of them to a readable string without assuming a fixed shape.
 */
function answerText(answer: JotformAnswer): string {
  if (answer.prettyFormat) return answer.prettyFormat;
  const raw = answer.answer;
  if (raw == null) return "";
  if (typeof raw === "string") return raw;
  if (Array.isArray(raw)) return raw.filter(Boolean).join(", ");
  if (typeof raw === "object") {
    const value = raw as Record<string, unknown>;
    if (typeof value.first === "string" || typeof value.last === "string") {
      return [value.first, value.last].filter(Boolean).join(" ");
    }
    if (typeof value.full === "string" && value.full) return value.full;
    if (typeof value.phone === "string") return [value.area, value.phone].filter(Boolean).join("");
  }
  return String(raw);
}

/**
 * Matched by question label rather than Jotform's internal field name/qid,
 * since the label is what a human confirmed when the form was built. Each
 * matcher requires ALL its tokens in the normalized label; more specific
 * matchers (e.g. "main" + "concern") are tried before ones that could collide
 * with a different question ("Your Name" vs "Site name or location" both
 * contain "name").
 */
const FIELD_MATCHERS: Array<{ key: string; include: string[]; exclude?: string[] }> = [
  { key: "fullName", include: ["name"], exclude: ["site", "location"] },
  { key: "phone", include: ["phone"] },
  { key: "phone", include: ["whatsapp"] },
  { key: "location", include: ["site"] },
  { key: "location", include: ["location"] },
  { key: "whoFor", include: ["considering"] },
  { key: "immediateConcern", include: ["immediate"] },
  { key: "mainConcern", include: ["main", "concern"] },
  { key: "description", include: ["describe"] },
  { key: "description", include: ["brief"] },
  { key: "interestedIn", include: ["next"] },
  { key: "preferredDay", include: ["preferred"] },
  { key: "timing", include: ["timing"] },
];

function matchFields(answers: JotformAnswer[]): { fields: Map<string, string>; unmapped: string[] } {
  const fields = new Map<string, string>();
  const remaining = answers
    .filter((answer) => answer.text)
    .map((answer) => ({ label: normalizeLabel(answer.text as string), value: answerText(answer) }));

  for (const matcher of FIELD_MATCHERS) {
    if (fields.has(matcher.key)) continue;
    const hit = remaining.find(
      (field) => matcher.include.every((token) => field.label.includes(token))
        && !matcher.exclude?.some((token) => field.label.includes(token)),
    );
    if (hit && hit.value) fields.set(matcher.key, hit.value);
  }

  const expected = ["whoFor", "mainConcern", "immediateConcern", "interestedIn"];
  const unmapped = expected.filter((key) => !fields.has(key));
  return { fields, unmapped };
}

function buildSummary(fields: Map<string, string>): string {
  const parts: string[] = [];
  if (fields.has("whoFor")) parts.push(`For: ${fields.get("whoFor")}.`);
  if (fields.has("mainConcern")) parts.push(`Main concern: ${fields.get("mainConcern")}.`);
  if (fields.has("immediateConcern")) parts.push(`Immediate concern: ${fields.get("immediateConcern")}.`);
  if (fields.has("description")) parts.push(fields.get("description") as string);
  // "Interested in" is expressed interest, not a commitment — worded as such per
  // system-guide.md so it never reads as a promise a scheduled assessment exists.
  if (fields.has("interestedIn")) parts.push(`Interested in: ${fields.get("interestedIn")}.`);

  // A preferred callback day/time is guidance from the form, never a task or
  // appointment — it is folded into the summary as context only, and nothing
  // in this module writes it to next_activity_at or creates any activity.
  const preferredDayAndTime = [fields.get("preferredDay"), fields.get("timing")].filter(Boolean).join(", ");
  if (preferredDayAndTime) parts.push(`Preferred callback: ${preferredDayAndTime}.`);

  return parts.length ? parts.join(" ") : "Jotform enquiry — see submission for details.";
}

/**
 * Pure and network-free so it can be unit tested without a live Jotform
 * account. Returns null when name or phone is missing so the submission can be
 * held for admin review instead of silently guessing at a customer identity.
 * "Immediate concern" only ever raises priority — it never creates a task,
 * appointment, or any other side effect; Eyeagle is not an emergency-response
 * service and this module makes no attempt to behave like one.
 */
export function mapJotformSubmission(submission: JotformSubmission): MappedJotformSubmission | null {
  const answers = Object.values(submission.answers ?? {});
  const { fields, unmapped } = matchFields(answers);

  const fullName = fields.get("fullName");
  const phone = fields.get("phone");
  if (!fullName || !phone) return null;

  const immediateConcern = fields.get("immediateConcern")?.trim().toLowerCase() === "yes";

  return {
    fullName,
    phone,
    city: fields.get("location"),
    summary: buildSummary(fields),
    priority: immediateConcern ? "urgent" : "normal",
    immediateConcern,
    unmapped,
  };
}

export type JotformFetchOptions = { apiKey: string; formId: string; maxPages?: number; pageSize?: number };

/**
 * Backs the "Refresh Jotform" action — a manual pull, not a poller. Simplicity
 * beats efficiency here: page through everything up to the cap and let the
 * caller dedupe against jotform_submissions.jotform_submission_id, so
 * correctness never depends on this pagination being perfectly incremental.
 */
export async function fetchJotformSubmissions(options: JotformFetchOptions): Promise<JotformSubmission[]> {
  const pageSize = options.pageSize ?? 100;
  const maxPages = options.maxPages ?? 20;
  const submissions: JotformSubmission[] = [];

  for (let page = 0; page < maxPages; page += 1) {
    const url = new URL(`https://api.jotform.com/form/${options.formId}/submissions`);
    url.searchParams.set("apiKey", options.apiKey);
    url.searchParams.set("limit", String(pageSize));
    url.searchParams.set("offset", String(page * pageSize));
    url.searchParams.set("orderby", "created_at");

    const response = await fetch(url, { signal: AbortSignal.timeout(15_000) });
    if (!response.ok) {
      throw new Error(`Jotform API returned ${response.status}: ${await response.text().catch(() => "")}`);
    }
    const body = await response.json() as { content?: JotformSubmission[] };
    const page_ = body.content ?? [];
    submissions.push(...page_);
    if (page_.length < pageSize) break;
  }

  return submissions.sort((first, second) => first.created_at.localeCompare(second.created_at));
}
