import type { OpportunityFormResponseDto } from "./opportunities.types";

export const NOT_ANSWERED = "Not answered";

export const OPPORTUNITY_FORM_FIELDS = [
  { key: "customerName", formName: "q2_textbox0", label: "Your Name", section: "contact" },
  { key: "phone", formName: "q4_phone2", label: "Phone Number / Whatsapp No.", section: "contact" },
  { key: "location", formName: "q10_textbox8", label: "Site name or location", section: "contact" },
  { key: "consideringFor", formName: "whoAre", label: "Who are you considering EyEagle for?", section: "response" },
  { key: "mainSafetyConcern", formName: "whatIs", label: "What is your main safety concern?", section: "response" },
  { key: "immediateSafetyConcern", formName: "q11_radio9", label: "Any immediate safety concern?", section: "response" },
  { key: "description", formName: "q12_textarea10", label: "Brief description of concern", section: "response" },
  { key: "interestedIn", formName: "whatWould", label: "What would you like next?", section: "response" },
  { key: "preferredDay", formName: "preferredTime", label: "Preferred time to contact", section: "response" },
  { key: "preferredTiming", formName: "timings", label: "Timings", section: "response" },
  { key: "contactConsent", formName: "q14_widget_TermsAndConditions12", label: "I agree to be contacted about this request.", section: "response" },
] as const satisfies ReadonlyArray<{
  key: keyof OpportunityFormResponseDto;
  formName: string;
  label: string;
  section: "contact" | "response";
}>;

function normalizeFormValue(value: unknown): string | string[] {
  if (Array.isArray(value)) {
    const values = value.map(String).filter(Boolean);
    return values.length ? values : NOT_ANSWERED;
  }
  if (value === undefined || value === null || value === "") return NOT_ANSWERED;
  if (typeof value === "object" && "full" in value) return normalizeFormValue((value as { full?: unknown }).full);
  return String(value);
}

export function mapOpportunityFormAnswers(item: OpportunityFormResponseDto): Record<string, string | string[]> {
  return Object.fromEntries(OPPORTUNITY_FORM_FIELDS.map(({ key, label }) => [label, normalizeFormValue(item[key])]));
}

type FormDataSource = {
  formContext?: Record<string, { name?: string; text?: string; answer?: unknown; prettyFormat?: string }> | null;
  formData?: Record<string, { name?: string; text?: string; answer?: unknown; prettyFormat?: string }> | null;
};

export function mapOpportunityListFormAnswers(item: FormDataSource): Record<string, string | string[]> {
  const fields = Object.values(item.formData || item.formContext || {});
  return Object.fromEntries(OPPORTUNITY_FORM_FIELDS.map(({ formName, label }) => {
    const field = fields.find((candidate) => candidate.name === formName && candidate.text === label)
      || fields.find((candidate) => candidate.text === label);
    return [label, normalizeFormValue(field?.answer ?? field?.prettyFormat)];
  }));
}

export function getAnsweredFormValue(answers: Record<string, string | string[]>, label: string): string | undefined {
  const value = answers[label];
  const normalized = Array.isArray(value) ? value.join(", ") : value;
  return normalized && normalized !== NOT_ANSWERED ? normalized : undefined;
}
