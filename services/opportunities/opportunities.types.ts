export type OpportunityHistory = {
  id: string;
  type: "imported" | "claimed" | "follow_up" | "sold" | "not_proceeding";
  note?: string;
  lostReason?: string;
  nextActionAt?: string;
  at: string;
};

export type Opportunity = {
  id: string;
  status: "new" | "open" | "won" | "lost";
  ownerUserId?: string | null;
  ownerName?: string | null;
  fullName: string;
  phone: string;
  email?: string | null;
  location?: string | null;
  interest?: string | null;
  summary?: string | null;
  formContext: Record<string, unknown>;
  submittedAt: string;
  source?: string | null;
  nextActionAt?: string | null;
  nextActionLabel?: string | null;
  lastActionAt?: string | null;
  lastNote?: string | null;
  closedAt?: string | null;
  lostReason?: string | null;
  history: OpportunityHistory[];
  workGroup?: "DUE" | "FOLLOW_UPS" | "CLOSED";
};

export type OpportunityFormResponseDto = {
  customerName?: string | null;
  phone?: string | null;
  location?: string | null;
  consideringFor?: string | string[] | null;
  mainSafetyConcern?: string | string[] | null;
  immediateSafetyConcern?: string | null;
  description?: string | null;
  interestedIn?: string | null;
  preferredDay?: string | null;
  preferredTiming?: string | null;
  contactConsent?: string | boolean | null;
};

export type OpportunityFormFieldDto = {
  name?: string;
  order?: string;
  text?: string;
  type?: string;
  answer?: unknown;
  prettyFormat?: string;
};

export type OpportunityDto = OpportunityFormResponseDto & {
  id: string;
  status?: string | null;
  ownerId?: string | number | null;
  ownerName?: string | null;
  owner?: { id?: string | number | null; name?: string | null } | null;
  fullName?: string | null;
  name?: string | null;
  phoneNumber?: string | null;
  email?: string | null;
  summary?: string | null;
  source?: string | null;
  submittedAt?: string | null;
  nextActionAt?: string | null;
  nextActionLabel?: string | null;
  lastActionAt?: string | null;
  lastNote?: string | null;
  closedAt?: string | null;
  lostReason?: string | null;
  formContext?: Record<string, OpportunityFormFieldDto> | null;
  formData?: Record<string, OpportunityFormFieldDto> | null;
};

export type OpportunityListEnvelope =
  | OpportunityDto[]
  | { data?: OpportunityDto[] | { content?: OpportunityDto[]; items?: OpportunityDto[]; opportunities?: OpportunityDto[] }; content?: OpportunityDto[]; items?: OpportunityDto[]; opportunities?: OpportunityDto[] };

export type OpportunityDetailEnvelope = OpportunityDto | { data?: OpportunityDto | null };

export type MyWorkOpportunityDto = OpportunityFormResponseDto & {
  id: string;
  customer?: string | null;
  owner?: string | { id?: string | number | null; name?: string | null } | null;
  ownerId?: string | number | null;
  ownerName?: string | null;
  salesNextAction?: string | null;
  salesNextActionAt?: string | null;
  lastUpdate?: string | null;
  status?: string | null;
  action?: string | null;
  submittedAt?: string | null;
  source?: string | null;
};

export type MyWorkOpportunityListEnvelope =
  | MyWorkOpportunityDto[]
  | { data?: MyWorkOpportunityDto[] | { content?: MyWorkOpportunityDto[]; items?: MyWorkOpportunityDto[]; opportunities?: MyWorkOpportunityDto[] }; content?: MyWorkOpportunityDto[]; items?: MyWorkOpportunityDto[]; opportunities?: MyWorkOpportunityDto[] };

export type AllSalesOpportunityDto = MyWorkOpportunityDto & {
  fullName?: string | null;
  phoneNumber?: string | null;
  interest?: string | null;
  enquirySummary?: string | null;
  summary?: string | null;
  ownerName?: string | null;
  salesOwner?: string | null;
  submittedAt?: string | null;
};

export type AllSalesOpportunityListEnvelope =
  | AllSalesOpportunityDto[]
  | { data?: AllSalesOpportunityDto[] | { content?: AllSalesOpportunityDto[]; items?: AllSalesOpportunityDto[]; opportunities?: AllSalesOpportunityDto[] }; content?: AllSalesOpportunityDto[]; items?: AllSalesOpportunityDto[]; opportunities?: AllSalesOpportunityDto[] };

export type SalesOpportunityFilter = "ALL" | "DUE" | "FOLLOW_UPS" | "CLOSED";

export type OpportunityActionOutcome = "FOLLOW_UP" | "NOT_PROCEEDING" | "SOLD";

export type OpportunityActionRequest = {
  outcome: OpportunityActionOutcome;
  nextFollowUp: string | null;
  reason: string | null;
  callSummary: string;
};

export type OpportunityActionHistoryDto = {
  id?: string | null;
  actionId?: string | null;
  outcome?: string | null;
  action?: string | null;
  type?: string | null;
  nextFollowUp?: string | null;
  nextActionAt?: string | null;
  reason?: string | null;
  callSummary?: string | null;
  summary?: string | null;
  note?: string | null;
  createdAt?: string | null;
  actionAt?: string | null;
  performedAt?: string | null;
  updatedAt?: string | null;
};

export type OpportunityActionHistoryEnvelope =
  | OpportunityActionHistoryDto[]
  | {
      data?: OpportunityActionHistoryDto[] | {
        content?: OpportunityActionHistoryDto[];
        items?: OpportunityActionHistoryDto[];
        actions?: OpportunityActionHistoryDto[];
        history?: OpportunityActionHistoryDto[];
      };
      content?: OpportunityActionHistoryDto[];
      items?: OpportunityActionHistoryDto[];
      actions?: OpportunityActionHistoryDto[];
      history?: OpportunityActionHistoryDto[];
    };

export type JotformSyncResult = {
  scanned?: number;
  imported?: number;
  repeated?: number;
  issues?: number;
  skipped?: number;
  lastSyncedAt?: string;
};

export type JotformSyncEnvelope = JotformSyncResult | { data?: JotformSyncResult };
