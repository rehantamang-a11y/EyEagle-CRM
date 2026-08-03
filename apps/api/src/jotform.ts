import { leadPriorities } from "@eyeagle/crm-shared";
import type { NormalizedEnquiry } from "./enquiries.js";

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

export type MappedJotformEnquiry = {
  submissionId: string;
  createdAt: string;
  enquiry: NormalizedEnquiry;
  /** Expected questions that could not be matched on this submission, e.g. after a form edit. */
  unmapped: string[];
};

/** The original submission, broken into fields, for display rather than lead creation. */
export type JotformFormContext = {
  submissionId: string;
  submittedAt: string;
  consideringFor?: string;
  mainConcern?: string;
  immediateConcern: boolean;
  immediateConcernRaw?: string;
  description?: string;
  location?: string;
  interestedIn?: string;
  preferredDay?: string;
  preferredTiming?: string;
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
    if (typeof value.addr_line1 === "string") {
      return [value.addr_line1, value.addr_line2, value.city, value.state].filter(Boolean).join(", ");
    }
  }
  return String(raw);
}

/**
 * Matched by question label rather than Jotform's internal field name/qid,
 * because the label is what a human confirmed when the form was built and is
 * far more stable to reason about without live API access. Each matcher is a
 * set of substrings that must ALL appear in the normalized label, checked in
 * order so a more specific matcher (e.g. "main" + "concern") is tried before a
 * more general one that could also match a different question.
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
  { key: "nextStep", include: ["next"] },
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

  const requiredForSummary = ["whoFor", "mainConcern", "immediateConcern", "nextStep"];
  const unmapped = requiredForSummary.filter((key) => !fields.has(key));
  return { fields, unmapped };
}

/**
 * "Any immediate safety concern?" is the operational urgency signal this form
 * captures, so it drives queue priority. Everything else defaults to normal;
 * there is no signal on this form for "high" or "low".
 */
function priorityFromImmediateConcern(value: string | undefined): typeof leadPriorities[number] {
  return value?.trim().toLowerCase() === "yes" ? "urgent" : "normal";
}

function buildSummary(fields: Map<string, string>): string {
  const parts: string[] = [];
  if (fields.has("whoFor")) parts.push(`For: ${fields.get("whoFor")}.`);
  if (fields.has("mainConcern")) parts.push(`Main concern: ${fields.get("mainConcern")}.`);
  if (fields.has("immediateConcern")) parts.push(`Immediate concern: ${fields.get("immediateConcern")}.`);
  if (fields.has("description")) parts.push(fields.get("description") as string);
  if (fields.has("nextStep")) parts.push(`Wants: ${fields.get("nextStep")}.`);

  // The schema has no structured place for a free-text contact preference — the
  // website intake's own preferredContactTime field has the same gap — so this
  // is folded into the summary, the one place an operator will actually see it.
  const preferredDayAndTime = [fields.get("preferredDay"), fields.get("timing")].filter(Boolean).join(", ");
  if (preferredDayAndTime) parts.push(`Preferred contact time: ${preferredDayAndTime}.`);

  return parts.length ? parts.join(" ") : "Jotform enquiry — see submission for details.";
}

/**
 * Pure and network-free so it can be unit tested against a fixture without a
 * live Jotform account. Returns null (rather than throwing) when a required
 * field is missing, so one malformed submission does not abort an entire sync.
 */
export function mapJotformSubmission(submission: JotformSubmission): MappedJotformEnquiry | null {
  const answers = Object.values(submission.answers ?? {});
  const { fields, unmapped } = matchFields(answers);

  const fullName = fields.get("fullName");
  const phone = fields.get("phone");
  if (!fullName || !phone) return null;

  const enquiry: NormalizedEnquiry = {
    fullName,
    phone,
    city: fields.get("location"),
    summary: buildSummary(fields),
    priority: priorityFromImmediateConcern(fields.get("immediateConcern")),
  };

  return { submissionId: submission.id, createdAt: submission.created_at, enquiry, unmapped };
}

/**
 * The display counterpart to mapJotformSubmission: instead of collapsing the
 * submission into enquiry_summary for lead creation, this keeps each answer as
 * its own field so an operator can see exactly what the customer selected,
 * unmodified, rather than a paraphrased sentence.
 */
export function describeJotformSubmission(submission: JotformSubmission): JotformFormContext {
  const answers = Object.values(submission.answers ?? {});
  const { fields, unmapped } = matchFields(answers);
  const immediateConcernRaw = fields.get("immediateConcern");

  return {
    submissionId: submission.id,
    submittedAt: submission.created_at,
    consideringFor: fields.get("whoFor"),
    mainConcern: fields.get("mainConcern"),
    immediateConcern: immediateConcernRaw?.trim().toLowerCase() === "yes",
    immediateConcernRaw,
    description: fields.get("description"),
    location: fields.get("location"),
    interestedIn: fields.get("nextStep"),
    preferredDay: fields.get("preferredDay"),
    preferredTiming: fields.get("timing"),
    unmapped,
  };
}

export type JotformFetchOptions = { apiKey: string; formId: string; maxPages?: number; pageSize?: number };

/**
 * A manual "sync now" trigger, not a poller, so simplicity beats efficiency:
 * page through submissions and let the caller filter against what has already
 * been synced. Correctness comes from the idempotency table on the submission
 * id, not from this pagination being perfectly incremental.
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
