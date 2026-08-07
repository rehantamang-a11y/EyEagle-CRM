import type { Opportunity } from "./opportunities.types";

export function normalizeOpportunityStatus(status?: string | null): string {
  return (status || "OPEN").trim().toUpperCase();
}

export function opportunityWorkGroup(status?: string | null): Opportunity["workGroup"] {
  switch (normalizeOpportunityStatus(status)) {
    case "DUE": return "DUE";
    case "FOLLOW_UP":
    case "FOLLOW_UPS": return "FOLLOW_UPS";
    case "CLOSED":
    case "NOT_PROCEEDING":
    case "SOLD": return "CLOSED";
    default: return undefined;
  }
}

export function isOpportunityClosed(status?: string | null): boolean {
  return opportunityWorkGroup(status) === "CLOSED";
}

export function opportunityStatusLabel(status?: string | null): string {
  const value = normalizeOpportunityStatus(status);
  const labels: Record<string, string> = {
    UNCLAIMED: "Unclaimed",
    DUE: "Due",
    FOLLOW_UP: "Follow-up",
    FOLLOW_UPS: "Follow-ups",
    OPEN: "Open",
    CLOSED: "Closed",
    NOT_PROCEEDING: "Not proceeding",
    SOLD: "Sold",
  };
  return labels[value] || value.toLowerCase().replaceAll("_", " ").replace(/^./, (character) => character.toUpperCase());
}
