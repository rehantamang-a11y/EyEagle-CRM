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
  nextActionAt?: string | null;
  nextActionLabel?: string | null;
  lastActionAt?: string | null;
  lastNote?: string | null;
  closedAt?: string | null;
  lostReason?: string | null;
  history: OpportunityHistory[];
  workGroup?: "DUE" | "FOLLOW_UPS" | "CLOSED";
};

export type OpportunityFormFieldDto = {
  order?: string;
  text?: string;
  type?: string;
  answer?: unknown;
  prettyFormat?: string;
};

export type OpportunityDto = {
  id: string;
  status?: string | null;
  ownerId?: string | number | null;
  ownerName?: string | null;
  fullName?: string | null;
  name?: string | null;
  customerName?: string | null;
  phone?: string | null;
  phoneNumber?: string | null;
  email?: string | null;
  location?: string | null;
  interestedIn?: string | null;
  consideringFor?: string | null;
  mainConcern?: string | null;
  preferredCallbackDay?: string | null;
  preferredCallbackTime?: string | null;
  summary?: string | null;
  submittedAt?: string | null;
  nextActionAt?: string | null;
  nextActionLabel?: string | null;
  lastActionAt?: string | null;
  lastNote?: string | null;
  closedAt?: string | null;
  lostReason?: string | null;
  formContext?: Record<string, OpportunityFormFieldDto> | null;
};

export type OpportunityListEnvelope =
  | OpportunityDto[]
  | { data?: OpportunityDto[] | { content?: OpportunityDto[]; items?: OpportunityDto[]; opportunities?: OpportunityDto[] }; content?: OpportunityDto[]; items?: OpportunityDto[]; opportunities?: OpportunityDto[] };

export type OpportunityDetailEnvelope = OpportunityDto | { data?: OpportunityDto | null };

export type MyWorkOpportunityDto = {
  id: string;
  customer?: string | null;
  salesNextAction?: string | null;
  salesNextActionAt?: string | null;
  lastUpdate?: string | null;
  status?: string | null;
  action?: string | null;
};

export type MyWorkOpportunityListEnvelope =
  | MyWorkOpportunityDto[]
  | { data?: MyWorkOpportunityDto[] | { content?: MyWorkOpportunityDto[]; items?: MyWorkOpportunityDto[]; opportunities?: MyWorkOpportunityDto[] }; content?: MyWorkOpportunityDto[]; items?: MyWorkOpportunityDto[]; opportunities?: MyWorkOpportunityDto[] };

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
