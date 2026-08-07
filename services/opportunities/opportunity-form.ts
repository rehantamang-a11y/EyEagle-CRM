import type { JotformOpportunityListDto, OpportunityDetailDto, OpportunityQuestionFieldsDto } from "./opportunities.types";

export const NOT_ANSWERED = "Not answered";

export const OPPORTUNITY_FORM_FIELDS = [
  { key: "customerName", formName: "q2_textbox0", label: "Your Name", section: "contact" },
  { key: "phone", formName: "q4_phone2", label: "Phone Number / Whatsapp No.", section: "contact" },
  { key: "location", formName: "q10_textbox8", label: "Site name or location", section: "contact" },
  { key: "consideringFor", formName: "whoAre", label: "Who are you considering EyEagle for?", section: "response" },
  { key: "safetyConcern", formName: "whatIs", label: "What is your main safety concern?", section: "response" },
  { key: "immediateConcern", formName: "q11_radio9", label: "Any immediate safety concern?", section: "response" },
  { key: "description", formName: "q12_textarea10", label: "Brief description of concern", section: "response" },
  { key: "interestedIn", formName: "whatWould", label: "What would you like next?", section: "response" },
  { key: "preferredDay", formName: "preferredTime", label: "Preferred time to contact", section: "response" },
  { key: "preferredTiming", formName: "timings", label: "Timings", section: "response" },
  { key: "contactConsent", formName: "q14_widget_TermsAndConditions12", label: "I agree to be contacted about this request.", section: "response" },
] as const satisfies ReadonlyArray<{
  key: keyof OpportunityQuestionFieldsDto;
  formName: string;
  label: string;
  section: "contact" | "response";
}>;

export type OpportunityFormKey = (typeof OPPORTUNITY_FORM_FIELDS)[number]["key"];
export const OPPORTUNITY_CONTACT_LABELS = OPPORTUNITY_FORM_FIELDS
  .filter(({ section }) => section === "contact")
  .map(({ label }) => label);

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
  const answers = Object.fromEntries(OPPORTUNITY_FORM_FIELDS.map(({ key, label }) => [label, normalizeFormValue(item[key])]));
  const consentField = OPPORTUNITY_FORM_FIELDS.find(({ key }) => key === "contactConsent");
  const consentSubmission = item.formSubmission?.find(({ question }) => question?.trim() === consentField?.label);
  if (consentField) answers[consentField.label] = normalizeFormValue(consentSubmission?.answer);
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
} {
  const formSource = item.formData && Object.keys(item.formData).length ? item.formData : item.formContext;
  const fields = Object.values(formSource || {});
  const validationIssues: string[] = [];
  const entries = OPPORTUNITY_FORM_FIELDS.map(({ key, formName, label }) => {
    const exactField = fields.find((candidate) => candidate.name === formName && candidate.text?.trim() === label);
    const labelField = exactField || fields.find((candidate) => candidate.text?.trim() === label);
    if (labelField && !exactField) validationIssues.push(`${String(key)} used an unexpected Jotform field name.`);

    const formAnswer = submittedFieldAnswer(labelField);
    const keyAnswer = normalizeFormValue(item[key]);
    if (comparable(formAnswer) !== comparable(keyAnswer)) {
      validationIssues.push(`${String(key)} does not match the submitted form answer.`);
    }
    return [label, formAnswer] as const;
  });

  return { answers: Object.fromEntries(entries), validationIssues };
}

export function emptyOpportunityFormAnswers(): Record<string, string | string[]> {
  return Object.fromEntries(OPPORTUNITY_FORM_FIELDS.map(({ label }) => [label, NOT_ANSWERED]));
}

export function getAnsweredFormValue(answers: Record<string, string | string[]>, key: OpportunityFormKey): string | undefined {
  const label = OPPORTUNITY_FORM_FIELDS.find((field) => field.key === key)?.label;
  if (!label) return undefined;
  const value = answers[label];
  const normalized = Array.isArray(value) ? value.join(", ") : value;
  return normalized && normalized !== NOT_ANSWERED ? normalized : undefined;
}
