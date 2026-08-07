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
  status: string;
  ownerUserId?: string | null;
  ownerName?: string | null;
  fullName: string;
  phone: string;
  email?: string | null;
  location?: string | null;
  interest?: string | null;
  summary?: string | null;
  formAnswers: Record<string, string | string[]>;
  formValidationIssues?: string[];
  submittedAt: string;
  source?: string | null;
  nextActionAt?: string | null;
  nextActionLabel?: string | null;
  lastActionAt?: string | null;
  workGroup?: "DUE" | "FOLLOW_UPS" | "CLOSED";
};

export type OpportunityQuestionFieldsDto = {
  customerName: string | null;
  phone: string | null;
  location: string | null;
  consideringFor: string | string[] | null;
  safetyConcern: string | string[] | null;
  immediateConcern: string | null;
  description: string | null;
  interestedIn: string | null;
  preferredDay: string | null;
  preferredTiming: string | null;
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

export type OpportunityOwnerDto = {
  id: string | number;
  name: string;
};

export type JotformOpportunityListDto = OpportunityQuestionFieldsDto & {
  id: string;
  status: string;
  owner: OpportunityOwnerDto | null;
  email: string | null;
  submittedAt: string;
  source: string | null;
  action?: string | null;
  formContext: Record<string, OpportunityFormFieldDto>;
  formData?: Record<string, OpportunityFormFieldDto> | null;
};

export type OpportunityListEnvelope =
  | JotformOpportunityListDto[]
  | { data?: JotformOpportunityListDto[] | { content?: JotformOpportunityListDto[]; items?: JotformOpportunityListDto[]; opportunities?: JotformOpportunityListDto[] }; content?: JotformOpportunityListDto[]; items?: JotformOpportunityListDto[]; opportunities?: JotformOpportunityListDto[] };

export type OpportunityFormSubmissionDto = {
  question?: string | null;
  answer?: unknown;
};

export type EmbeddedOpportunityActivityDto = {
  opportunityStatus?: string | null;
  createdAt?: string | null;
};

export type OpportunityDetailDto = OpportunityQuestionFieldsDto & {
  id: string;
  status?: string | null;
  email: string | null;
  source: string | null;
  submittedAt: string;
  owner: OpportunityOwnerDto | null;
  formSubmission?: OpportunityFormSubmissionDto[] | null;
  activityHistory?: EmbeddedOpportunityActivityDto[] | null;
};

export type OpportunityDetailEnvelope = OpportunityDetailDto | { data?: OpportunityDetailDto | null };

export type MyWorkOpportunityDto = {
  id: string;
  customer: string | null;
  salesNextAction?: string | null;
  salesNextActionAt?: string | null;
  lastUpdatedAt?: string | null;
  lastUpdate?: string | null;
  status: string;
  action?: string | null;
};

export type MyWorkOpportunityListEnvelope =
  | MyWorkOpportunityDto[]
  | { data?: MyWorkOpportunityDto[] | { content?: MyWorkOpportunityDto[]; items?: MyWorkOpportunityDto[]; opportunities?: MyWorkOpportunityDto[] }; content?: MyWorkOpportunityDto[]; items?: MyWorkOpportunityDto[]; opportunities?: MyWorkOpportunityDto[] };

export type AllSalesOpportunityDto = {
  id: string;
  customer: string | null;
  owner: string | null;
  salesNextAction?: string | null;
  salesNextActionAt?: string | null;
  lastUpdatedAt?: string | null;
  lastUpdate?: string | null;
  status: string;
  action?: string | null;
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
