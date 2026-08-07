import type { Opportunity } from "./opportunities.types";

type OpportunityDateField = "submittedAt" | "lastActionAt";

const timestamp = (value?: string | null): number => {
  if (!value) return Number.NEGATIVE_INFINITY;
  const parsed = new Date(value).getTime();
  return Number.isNaN(parsed) ? Number.NEGATIVE_INFINITY : parsed;
};

export function sortOpportunitiesLatestFirst(items: Opportunity[], field: OpportunityDateField): Opportunity[] {
  return [...items].sort((left, right) => timestamp(right[field]) - timestamp(left[field]));
}
