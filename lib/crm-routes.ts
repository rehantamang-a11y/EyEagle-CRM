import type { SalesOpportunityFilter } from "@/services/opportunities/opportunities.types";

export type CrmView = "new-enquiries" | "my-work" | "all-sales";

export const SALES_FILTERS: readonly SalesOpportunityFilter[] = ["ALL", "DUE", "FOLLOW_UPS", "CLOSED"];

export function parseSalesFilter(value?: string | null): SalesOpportunityFilter {
  const normalized = value?.toUpperCase();
  return SALES_FILTERS.includes(normalized as SalesOpportunityFilter)
    ? normalized as SalesOpportunityFilter
    : "ALL";
}

export function crmListHref(view: CrmView, filter: SalesOpportunityFilter = "ALL", search = "") {
  const params = new URLSearchParams();
  if (view !== "new-enquiries") params.set("filter", filter);
  const query = search.trim();
  if (query) params.set("q", query);
  const encoded = params.toString();
  return `/${view}${encoded ? `?${encoded}` : ""}`;
}

export function safeNextPath(value?: string | null) {
  return value?.startsWith("/") && !value.startsWith("//") ? value : "/new-enquiries";
}
