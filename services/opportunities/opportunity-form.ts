import type { JotformOpportunityListDto, OpportunityDetailDto, OpportunityFormFieldDto, OpportunityQuestionFieldsDto } from "./opportunities.types";

export const NOT_ANSWERED = "Not answered";

type OpportunityFormField = {
  key: keyof OpportunityQuestionFieldsDto;
  formName: string;
  label: string;
  section: "contact" | "response";
};

export const OPPORTUNITY_FORM_FIELDS = [
  { key: "customerName", formName: "q2_textbox0", label: "Your Name", section: "contact" },
  { key: "phone", formName: "q4_phone2", label: "Phone Number / Whatsapp No.", section: "contact" },
  { key: "email", formName: "email", label: "Email address", section: "contact" },
  { key: "location", formName: "q10_textbox8", label: "Site name or location", section: "contact" },
  { key: "consideringFor", formName: "whoAre", label: "Who are you considering Eyeagle for?", section: "response" },
  { key: "safetyConcern", formName: "whatIs", label: "What is your main safety concern?", section: "response" },
  { key: "immediateConcern", formName: "q11_radio9", label: "Any immediate safety concern?", section: "response" },
  { key: "description", formName: "q12_textarea10", label: "Brief description of concern", section: "response" },
  { key: "interestedIn", formName: "whatWould", label: "What would you like next?", section: "response" },
  { key: "preferredDay", formName: "preferredTime", label: "Preferred time to contact", section: "response" },
  { key: "preferredTiming", formName: "timings", label: "Timings", section: "response" },
  { key: "contactConsent", formName: "q14_widget_TermsAndConditions12", label: "I agree to be contacted about this request.", section: "response" },
] as const satisfies ReadonlyArray<OpportunityFormField>;

export const NEW_OPPORTUNITY_FORM_FIELDS = [
  { key: "customerName", formName: "q2_textbox0", label: "Your Name", section: "contact" },
  { key: "phone", formName: "q4_phone2", label: "Phone Number / WhatsApp No.", section: "contact" },
  { key: "email", formName: "email", label: "Email address", section: "contact" },
  { key: "location", formName: "q10_textbox8", label: "City or location", section: "contact" },
  { key: "description", formName: "q12_textarea10", label: "Tell us more about your enquiry", section: "response" },
  { key: "interestedIn", formName: "whatWould", label: "What can we help with?", section: "response" },
  { key: "preferredTiming", formName: "timings", label: "Preferred time", section: "response" },
  { key: "contactConsent", formName: "q14_widget_TermsAndConditions12", label: "I agree to be contacted about this request.", section: "response" },
] as const satisfies ReadonlyArray<OpportunityFormField>;

const ALL_OPPORTUNITY_FORM_FIELDS: ReadonlyArray<OpportunityFormField> = [
  ...NEW_OPPORTUNITY_FORM_FIELDS,
  ...OPPORTUNITY_FORM_FIELDS,
];
const NEW_FORM_LABELS = new Set(NEW_OPPORTUNITY_FORM_FIELDS
  .filter(({ label }) => !OPPORTUNITY_FORM_FIELDS.some(
    (legacy) => legacy.label.toLocaleLowerCase() === label.toLocaleLowerCase(),
  ))
  .map(({ label }) => label.toLocaleLowerCase()));

export type OpportunityFormKey = (typeof OPPORTUNITY_FORM_FIELDS)[number]["key"] | (typeof NEW_OPPORTUNITY_FORM_FIELDS)[number]["key"];
export const OPPORTUNITY_CONTACT_LABELS = [...new Set(ALL_OPPORTUNITY_FORM_FIELDS
  .filter(({ section }) => section === "contact")
  .map(({ label }) => label))];

function registryForLabels(labels: Array<string | null | undefined>): ReadonlyArray<OpportunityFormField> {
  return labels.some((label) => label && NEW_FORM_LABELS.has(label.trim().toLocaleLowerCase()))
    ? NEW_OPPORTUNITY_FORM_FIELDS
    : OPPORTUNITY_FORM_FIELDS;
}

function normalizeFormValue(value: unknown): string | string[] {
  if (Array.isArray(value)) {
    const values = value.map(String).filter(Boolean);
    return values.length ? values : NOT_ANSWERED;
  }
  if (value === undefined || value === null || value === "") return NOT_ANSWERED;
  if (typeof value === "object" && "full" in value) return normalizeFormValue((value as { full?: unknown }).full);
  return String(value);
}

export function mapOpportunityDetailFormAnswers(item: OpportunityDetailDto): Record<string, string | string[]> {
  const registry = registryForLabels((item.formSubmission || []).map(({ question }) => question));
  const answers = Object.fromEntries(registry.map(({ key, label }) => [label, normalizeFormValue(item[key])]));
  const knownLabels = new Map(registry.map((field) => [field.label.toLocaleLowerCase(), field.label]));
  for (const submission of item.formSubmission || []) {
    const question = submission.question?.trim();
    if (!question) continue;
    const canonicalLabel = knownLabels.get(question.toLocaleLowerCase());
    answers[canonicalLabel || question] = normalizeFormValue(submission.answer);
  }
  return answers;
}

function comparable(value: string | string[]): string {
  return (Array.isArray(value) ? value.join(", ") : value).trim().toLocaleLowerCase();
}

function submittedFieldAnswer(field?: { answer?: unknown; prettyFormat?: string }): string | string[] {
  const answer = normalizeFormValue(field?.answer);
  return answer === NOT_ANSWERED ? normalizeFormValue(field?.prettyFormat) : answer;
}

export function mapOpportunityListFormData(item: JotformOpportunityListDto): {
  answers: Record<string, string | string[]>;
  validationIssues: string[];
  mappedKeys: Set<OpportunityFormKey>;
} {
  const formSource = item.formData && Object.keys(item.formData).length ? item.formData : item.formContext;
  const fields = Object.values(formSource || {});
  const registry = registryForLabels(fields.map(({ text }) => text));
  const validationIssues: string[] = [];
  const matchedFields = new Set<OpportunityFormFieldDto>();
  const mappedKeys = new Set<OpportunityFormKey>();
  const entries: Array<[string, string | string[]]> = registry.map(({ key, formName, label }) => {
    const nameField = fields.find((candidate) => candidate.name === formName);
    const labelField = nameField || fields.find((candidate) => candidate.text?.trim() === label);
    if (labelField) {
      matchedFields.add(labelField);
      mappedKeys.add(key);
    }
    if (labelField && !nameField) validationIssues.push(`${String(key)} used an unexpected Jotform field name.`);
    if (nameField && nameField.text?.trim() !== label) {
      validationIssues.push(`${String(key)} used an unexpected Jotform question label.`);
    }

    const formAnswer = submittedFieldAnswer(labelField);
    const keyAnswer = normalizeFormValue(item[key]);
    if (comparable(formAnswer) !== comparable(keyAnswer)) {
      validationIssues.push(`${String(key)} does not match the submitted form answer.`);
    }
    return [label, formAnswer];
  });

  for (const field of fields) {
    const label = field.text?.trim();
    if (matchedFields.has(field) || !label || entries.some(([knownLabel]) => knownLabel === label)) continue;
    entries.push([label, submittedFieldAnswer(field)]);
  }

  return { answers: Object.fromEntries(entries), validationIssues, mappedKeys };
}

export function emptyOpportunityFormAnswers(): Record<string, string | string[]> {
  return Object.fromEntries(OPPORTUNITY_FORM_FIELDS.map(({ label }) => [label, NOT_ANSWERED]));
}

export function getAnsweredFormValue(answers: Record<string, string | string[]>, key: OpportunityFormKey): string | undefined {
  for (const { label } of ALL_OPPORTUNITY_FORM_FIELDS.filter((field) => field.key === key)) {
    const value = answers[label];
    const normalized = Array.isArray(value) ? value.join(", ") : value;
    if (normalized && normalized !== NOT_ANSWERED) return normalized;
  }
  return undefined;
}
