import { apiRequest } from "@/services/api/client";
import type { JotformSyncEnvelope, JotformSyncResult, MyWorkOpportunityDto, MyWorkOpportunityListEnvelope, Opportunity, OpportunityActionHistoryDto, OpportunityActionHistoryEnvelope, OpportunityActionRequest, OpportunityDetailEnvelope, OpportunityDto, OpportunityListEnvelope } from "./opportunities.types";

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

function normalizeAnswer(value: unknown, prettyFormat?: string): string | string[] | undefined {
  if (Array.isArray(value)) return value.map(String);
  if (value && typeof value === "object" && "full" in value) return String((value as { full: unknown }).full);
  if (value !== undefined && value !== null && value !== "") return String(value);
  return prettyFormat || undefined;
}

function normalizeFormAnswers(item: OpportunityDto): Record<string, string | string[]> {
  const fields = Object.values(item.formContext || {}).sort((a, b) => Number(a.order || 0) - Number(b.order || 0));
  const answers: Record<string, string | string[]> = {};

  for (const field of fields) {
    if (!field.text) continue;
    const value = normalizeAnswer(field.answer, field.prettyFormat);
    if (value !== undefined) answers[field.text] = value;
  }

  const suppliedName = item.fullName || item.customerName || item.name;
  const suppliedPhone = item.phone || item.phoneNumber;
  if (!answers["Your Name"] && suppliedName) answers["Your Name"] = suppliedName;
  if (!answers["Phone Number / Whatsapp No."] && suppliedPhone) answers["Phone Number / Whatsapp No."] = suppliedPhone;
  if (!answers["Site name or location"] && item.location) answers["Site name or location"] = item.location;
  if (!answers["Who are you considering EyEagle for?"] && item.consideringFor) answers["Who are you considering EyEagle for?"] = [item.consideringFor];
  if (!answers["Any immediate safety concern?"] && item.mainConcern) answers["Any immediate safety concern?"] = item.mainConcern;
  if (!answers["What would you like next?"] && item.interestedIn) answers["What would you like next?"] = item.interestedIn;
  if (!answers["Preferred time to contact"] && item.preferredCallbackTime) answers["Preferred time to contact"] = item.preferredCallbackTime;
  if (!answers.Timings && item.preferredCallbackDay) answers.Timings = item.preferredCallbackDay;
  return answers;
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
  if (!opportunityId || opportunityId.startsWith("demo-")) {
    throw new Error("This demo opportunity is read-only and cannot be sent to the backend.");
  }
  return encodeURIComponent(opportunityId);
}

export function mapOpportunityDto(item: OpportunityDto): Opportunity {
  const formAnswers = normalizeFormAnswers(item);
  const status = normalizeStatus(item.status);
  const formValue = (label: string) => {
    const value = formAnswers[label];
    return Array.isArray(value) ? value.join(", ") : value;
  };
  const fullName = item.fullName || item.customerName || item.name || formValue("Your Name") || "Unnamed enquiry";
  const phone = item.phone || item.phoneNumber || formValue("Phone Number / Whatsapp No.") || "Phone not provided";

  return {
    id: normalizeOpportunityId(item.id),
    status,
    ownerUserId: item.ownerId == null ? null : String(item.ownerId),
    ownerName: item.ownerName || null,
    fullName,
    phone,
    email: item.email,
    location: item.location,
    interest: item.interestedIn || formValue("What would you like next?") || null,
    summary: item.summary || formValue("Brief description of concern") || null,
    formContext: { formAnswers },
    submittedAt: item.submittedAt || "",
    nextActionAt: item.nextActionAt,
    nextActionLabel: item.nextActionLabel || (status === "open" && !item.nextActionAt ? "Call customer" : null),
    lastActionAt: item.lastActionAt,
    lastNote: item.lastNote,
    closedAt: item.closedAt,
    lostReason: item.lostReason,
    history: [],
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
  return {
    id: normalizeOpportunityId(item.id),
    status: backendStatus === "SOLD" ? "won" : workGroup === "CLOSED" ? "lost" : "open",
    fullName: item.customer || "Unnamed enquiry",
    phone: "Phone not provided",
    location: null,
    interest: null,
    summary: null,
    formContext: { formAnswers: {} },
    submittedAt: "",
    nextActionAt: item.salesNextActionAt,
    nextActionLabel: item.salesNextAction || (workGroup === "DUE" ? "Call customer" : null),
    lastActionAt: item.lastUpdate,
    history: [],
    workGroup,
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
    return normalizeOpportunityList(payload).map(mapOpportunityDto);
  },
  async listMyWork() {
    const payload = await apiRequest<MyWorkOpportunityListEnvelope>("/crm/opportunities/my-work");
    return normalizeList(payload).map(mapMyWorkOpportunityDto);
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
