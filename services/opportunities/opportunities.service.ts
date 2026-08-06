import { apiRequest } from "@/services/api/client";
import type { AllSalesOpportunityDto, AllSalesOpportunityListEnvelope, JotformSyncEnvelope, JotformSyncResult, MyWorkOpportunityDto, MyWorkOpportunityListEnvelope, Opportunity, OpportunityActionHistoryDto, OpportunityActionHistoryEnvelope, OpportunityActionRequest, OpportunityDetailEnvelope, OpportunityDto, OpportunityListEnvelope, SalesOpportunityFilter } from "./opportunities.types";
import { getAnsweredFormValue, mapOpportunityFormAnswers, mapOpportunityListFormAnswers } from "./opportunity-form";

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

export function normalizeOpportunityList(payload: OpportunityListEnvelope): OpportunityDto[] {
  return normalizeList(payload);
}

function normalizeOpportunityDetail(payload: OpportunityDetailEnvelope): OpportunityDto {
  if ("id" in payload) return payload;
  if (payload.data) return payload.data;
  throw new Error("The opportunity details response did not contain an opportunity.");
}

function normalizeStatus(status?: string | null): Opportunity["status"] {
  const value = (status || "OPEN").toUpperCase();
  if (value === "UNCLAIMED" || value === "NEW") return "new";
  if (value === "WON" || value === "SOLD") return "won";
  if (value === "LOST" || value === "NOT_PROCEEDING" || value === "CLOSED") return "lost";
  return "open";
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

export function mapOpportunityDto(item: OpportunityDto): Opportunity {
  const formAnswers = mapOpportunityFormAnswers({
    ...item,
    customerName: item.customerName || item.fullName || item.name,
    phone: item.phone || item.phoneNumber,
  });
  const status = normalizeStatus(item.status);
  const formValue = (label: string) => getAnsweredFormValue(formAnswers, label);
  const fullName = item.fullName || item.customerName || item.name || formValue("Your Name") || "Unnamed enquiry";
  const phone = item.phone || item.phoneNumber || formValue("Phone Number / Whatsapp No.") || "Phone not provided";

  return {
    id: normalizeOpportunityId(item.id),
    status,
    ownerUserId: item.ownerId == null && item.owner?.id == null ? null : String(item.ownerId ?? item.owner?.id),
    ownerName: item.ownerName || item.owner?.name || null,
    fullName,
    phone,
    email: item.email,
    location: item.location,
    interest: item.interestedIn || formValue("What would you like next?") || null,
    summary: item.summary || item.description || formValue("Brief description of concern") || null,
    formContext: { formAnswers },
    submittedAt: item.submittedAt || "",
    source: item.source || null,
    nextActionAt: item.nextActionAt,
    nextActionLabel: item.nextActionLabel || (status === "open" && !item.nextActionAt ? "Call customer" : null),
    lastActionAt: item.lastActionAt,
    lastNote: item.lastNote,
    closedAt: item.closedAt,
    lostReason: item.lostReason,
    history: [],
  };
}

export function mapOpportunityListDto(item: OpportunityDto): Opportunity {
  const mapped = mapOpportunityDto(item);
  const formAnswers = mapOpportunityListFormAnswers(item);
  const formValue = (label: string) => getAnsweredFormValue(formAnswers, label);

  return {
    ...mapped,
    fullName: formValue("Your Name") || mapped.fullName,
    phone: formValue("Phone Number / Whatsapp No.") || mapped.phone,
    location: formValue("Site name or location") || mapped.location,
    interest: formValue("What would you like next?") || null,
    summary: formValue("Brief description of concern") || null,
    formContext: { formAnswers },
  };
}

function normalizeMyWorkGroup(status?: string | null): Opportunity["workGroup"] {
  const value = (status || "").toUpperCase();
  if (value === "FOLLOW_UP" || value === "FOLLOW_UPS") return "FOLLOW_UPS";
  if (value === "CLOSED" || value === "SOLD" || value === "NOT_PROCEEDING") return "CLOSED";
  return "DUE";
}

export function mapMyWorkOpportunityDto(item: MyWorkOpportunityDto): Opportunity {
  const workGroup = normalizeMyWorkGroup(item.status);
  const backendStatus = (item.status || "").toUpperCase();
  const owner = typeof item.owner === "string" ? null : item.owner;
  const formAnswers = mapOpportunityFormAnswers({ ...item, customerName: item.customerName || item.customer });
  return {
    id: normalizeOpportunityId(item.id),
    status: backendStatus === "SOLD" ? "won" : workGroup === "CLOSED" ? "lost" : "open",
    ownerUserId: item.ownerId == null && owner?.id == null ? null : String(item.ownerId ?? owner?.id),
    ownerName: item.ownerName || (typeof item.owner === "string" ? item.owner : item.owner?.name) || null,
    fullName: String(item.customerName || item.customer || "Unnamed enquiry"),
    phone: String(item.phone || "Phone not provided"),
    location: item.location ? String(item.location) : null,
    interest: item.interestedIn ? String(item.interestedIn) : null,
    summary: item.description ? String(item.description) : null,
    formContext: { formAnswers },
    submittedAt: item.submittedAt ? String(item.submittedAt) : "",
    source: item.source || null,
    nextActionAt: item.salesNextActionAt,
    nextActionLabel: item.salesNextAction || (workGroup === "DUE" ? "Call customer" : null),
    lastActionAt: item.lastUpdate,
    history: [],
    workGroup,
  };
}

export function mapAllSalesOpportunityDto(item: AllSalesOpportunityDto): Opportunity {
  const mapped = mapMyWorkOpportunityDto(item);
  const owner = typeof item.owner === "string" ? item.owner : item.owner?.name;
  return {
    ...mapped,
    fullName: item.customer || item.customerName || item.fullName || "Unnamed enquiry",
    phone: item.phone || item.phoneNumber || "Phone not provided",
    location: item.location || null,
    interest: item.interestedIn || item.interest || null,
    summary: item.enquirySummary || item.summary || null,
    ownerName: item.ownerName || item.salesOwner || owner || null,
    submittedAt: item.submittedAt || "",
  };
}

function normalizeHistoryType(value?: string | null): Opportunity["history"][number]["type"] {
  const type = (value || "action").toUpperCase();
  if (type === "FOLLOW_UP" || type === "FOLLOW_UPS") return "follow_up";
  if (type === "NOT_PROCEEDING") return "not_proceeding";
  if (type === "SOLD") return "sold";
  if (type === "CLAIMED" || type === "OWNERSHIP") return "claimed";
  return "imported";
}

export function mapOpportunityActionHistoryDto(item: OpportunityActionHistoryDto, index: number): Opportunity["history"][number] {
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
    return mapOpportunityDto(normalizeOpportunityDetail(payload));
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
