"use client";

import { useQuery } from "@tanstack/react-query";
import { opportunitiesService } from "@/services/opportunities/opportunities.service";
import { opportunityKeys } from "./opportunity-query-keys";

export function useOpportunityActionHistory(opportunityId?: string, enabled = true) {
  return useQuery({
    queryKey: opportunityKeys.actionHistory(opportunityId),
    queryFn: () => opportunitiesService.listActionHistory(opportunityId!),
    enabled: enabled && Boolean(opportunityId),
  });
}
