import { apiRequest } from "@/services/api/client";
import type { AllSalesOpportunityDto, AllSalesOpportunityListEnvelope, JotformOpportunityListDto, JotformSyncEnvelope, JotformSyncResult, MyWorkOpportunityDto, MyWorkOpportunityListEnvelope, Opportunity, OpportunityActionHistoryDto, OpportunityActionHistoryEnvelope, OpportunityActionRequest, OpportunityDetailDto, OpportunityDetailEnvelope, OpportunityHistory, OpportunityListEnvelope, SalesOpportunityFilter } from "./opportunities.types";
import { emptyOpportunityFormAnswers, getAnsweredFormValue, mapOpportunityDetailFormAnswers, mapOpportunityListFormData } from "./opportunity-form";
import { normalizeOpportunityStatus, opportunityWorkGroup } from "./opportunity-status";

type ListEnvelope<T> = T[] | {
  data?: T[] | { content?: T[]; items?: T[]; opportunities?: T[] };
  content?: T[];
  items?: T[];
  opportunities?: T[];
  actions?: T[];
  history?: T[];
};

function normalizeList<T>(payload: ListEnvelope<T>): T[] {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload.data)) return payload.data;
  if (payload.data && !Array.isArray(payload.data)) {
    if (Array.isArray(payload.data.content)) return payload.data.content;
    if (Array.isArray(payload.data.items)) return payload.data.items;
    if (Array.isArray(payload.data.opportunities)) return payload.data.opportunities;
    if ("actions" in payload.data && Array.isArray(payload.data.actions)) return payload.data.actions;
    if ("history" in payload.data && Array.isArray(payload.data.history)) return payload.data.history;
  }
  if (Array.isArray(payload.content)) return payload.content;
  if (Array.isArray(payload.items)) return payload.items;
  if (Array.isArray(payload.opportunities)) return payload.opportunities;
  if (Array.isArray(payload.actions)) return payload.actions;
  if (Array.isArray(payload.history)) return payload.history;
  throw new Error("The opportunities response did not contain a supported list.");
}

export function normalizeOpportunityList(payload: OpportunityListEnvelope): JotformOpportunityListDto[] {
  return normalizeList(payload);
}

function normalizeOpportunityDetail(payload: OpportunityDetailEnvelope): OpportunityDetailDto {
  if ("id" in payload) return payload;
  if (payload.data) return payload.data;
  throw new Error("The opportunity details response did not contain an opportunity.");
}

function normalizeOpportunityId(id: unknown): string {
  if (typeof id === "string") return id;
  if (Number.isSafeInteger(id)) return String(id);
  throw new Error(
    "The opportunities API returned an unsafe numeric ID. The backend must serialize opportunity IDs as JSON strings.",
  );
}

function backendOpportunityId(opportunityId: string): string {
  if (!opportunityId) throw new Error("An opportunity ID is required.");
  return encodeURIComponent(opportunityId);
}

export function mapOpportunityDetailDto(item: OpportunityDetailDto): Opportunity {
  const formAnswers = mapOpportunityDetailFormAnswers(item);
  const embeddedStatus = item.activityHistory?.[0]?.opportunityStatus;
  const status = normalizeOpportunityStatus(item.status || embeddedStatus);
  const formValue = (key: Parameters<typeof getAnsweredFormValue>[1]) => getAnsweredFormValue(formAnswers, key);

  return {
    id: normalizeOpportunityId(item.id),
    status,
    ownerUserId: item.owner?.id == null ? null : String(item.owner.id),
    ownerName: item.owner?.name || null,
    fullName: item.customerName || formValue("customerName") || "Unnamed enquiry",
    phone: item.phone || formValue("phone") || "Phone not provided",
    email: item.email,
    location: item.location,
    interest: item.interestedIn || formValue("interestedIn") || null,
    summary: item.description || formValue("description") || null,
    formAnswers,
    submittedAt: item.submittedAt,
    source: item.source || null,
  };
}

export function mapOpportunityListDto(item: JotformOpportunityListDto): Opportunity {
  const { answers: formAnswers, validationIssues } = mapOpportunityListFormData(item);
  const formValue = (key: Parameters<typeof getAnsweredFormValue>[1]) => getAnsweredFormValue(formAnswers, key);

  return {
    id: normalizeOpportunityId(item.id),
    status: normalizeOpportunityStatus(item.status),
    ownerUserId: item.owner?.id == null ? null : String(item.owner.id),
    ownerName: item.owner?.name || null,
    fullName: formValue("customerName") || "Unnamed enquiry",
    phone: formValue("phone") || "Phone not provided",
    email: item.email,
    location: formValue("location") || null,
    interest: formValue("interestedIn") || null,
    summary: formValue("description") || null,
    formAnswers,
    formValidationIssues: validationIssues,
    submittedAt: item.submittedAt,
    source: item.source,
  };
}

export function mapMyWorkOpportunityDto(item: MyWorkOpportunityDto): Opportunity {
  const status = normalizeOpportunityStatus(item.status);
  const workGroup = opportunityWorkGroup(status);
  return {
    id: normalizeOpportunityId(item.id),
    status,
    fullName: item.customer || "Unnamed enquiry",
    phone: "Phone not provided",
    location: null,
    interest: null,
    summary: null,
    formAnswers: emptyOpportunityFormAnswers(),
    submittedAt: "",
    source: null,
    nextActionAt: item.salesNextActionAt,
    nextActionLabel: item.salesNextAction || (workGroup === "DUE" ? "Call customer" : null),
    lastActionAt: item.lastUpdatedAt || item.lastUpdate,
    workGroup,
  };
}

export function mapAllSalesOpportunityDto(item: AllSalesOpportunityDto): Opportunity {
  const status = normalizeOpportunityStatus(item.status);
  return {
    id: normalizeOpportunityId(item.id),
    status,
    ownerName: item.owner,
    fullName: item.customer || "Unnamed enquiry",
    phone: "Phone not provided",
    location: null,
    interest: null,
    summary: null,
    formAnswers: emptyOpportunityFormAnswers(),
    submittedAt: "",
    nextActionAt: item.salesNextActionAt,
    nextActionLabel: item.salesNextAction,
    lastActionAt: item.lastUpdatedAt || item.lastUpdate,
    workGroup: opportunityWorkGroup(status),
  };
}

function normalizeHistoryType(value?: string | null): OpportunityHistory["type"] {
  const type = (value || "action").toUpperCase();
  if (type === "FOLLOW_UP" || type === "FOLLOW_UPS") return "follow_up";
  if (type === "NOT_PROCEEDING") return "not_proceeding";
  if (type === "SOLD") return "sold";
  if (type === "CLAIMED" || type === "OWNERSHIP") return "claimed";
  return "imported";
}

export function mapOpportunityActionHistoryDto(item: OpportunityActionHistoryDto, index: number): OpportunityHistory {
  const rawType = item.outcome || item.action || item.type;
  const at = item.createdAt || item.actionAt || item.performedAt || item.updatedAt || "";
  return {
    id: item.id || item.actionId || `${at || "action"}-${index}`,
    type: normalizeHistoryType(rawType),
    note: item.callSummary || item.summary || item.note || undefined,
    lostReason: item.reason || undefined,
    nextActionAt: item.nextFollowUp || item.nextActionAt || undefined,
    at,
  };
}

export const opportunitiesService = {
  async listUnclaimed() {
    const payload = await apiRequest<OpportunityListEnvelope>("/crm/opportunities?view=unclaimed");
    return normalizeOpportunityList(payload).map(mapOpportunityListDto);
  },
  async listMyWork() {
    const payload = await apiRequest<MyWorkOpportunityListEnvelope>("/crm/opportunities/my-work");
    return normalizeList(payload).map(mapMyWorkOpportunityDto);
  },
  async listSales(filter: SalesOpportunityFilter = "ALL", search = "") {
    const query = search.trim();
    const path = `/crm/opportunities/all-sales?filter=${filter}${query ? `&q=${encodeURIComponent(query)}` : ""}`;
    const payload = await apiRequest<AllSalesOpportunityListEnvelope>(path);
    return normalizeList(payload).map(mapAllSalesOpportunityDto);
  },
  async getOpportunity(opportunityId: string) {
    const payload = await apiRequest<OpportunityDetailEnvelope>(
      `/crm/opportunities/${backendOpportunityId(opportunityId)}`,
    );
    return mapOpportunityDetailDto(normalizeOpportunityDetail(payload));
  },
  async syncJotform(): Promise<JotformSyncResult> {
    const payload = await apiRequest<JotformSyncEnvelope | undefined>("/crm/jotform/sync", { method: "POST" });
    if (!payload) return {};
    if ("data" in payload) return payload.data || {};
    return payload as JotformSyncResult;
  },
  async takeOwnership(opportunityId: string): Promise<void> {
    await apiRequest<unknown>(`/crm/opportunities/${backendOpportunityId(opportunityId)}/ownership`, { method: "POST" });
  },
  async saveAction(opportunityId: string, action: OpportunityActionRequest): Promise<void> {
    await apiRequest<unknown>(`/crm/opportunities/${backendOpportunityId(opportunityId)}/actions`, {
      method: "POST",
      body: action,
    });
  },
  async listActionHistory(opportunityId: string) {
    const payload = await apiRequest<OpportunityActionHistoryEnvelope>(
      `/crm/opportunities/${backendOpportunityId(opportunityId)}/actions`,
    );
    return normalizeList(payload).map(mapOpportunityActionHistoryDto);
  },
};
