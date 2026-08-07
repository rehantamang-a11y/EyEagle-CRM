"use client";

import { useQuery } from "@tanstack/react-query";
import { opportunitiesService } from "@/services/opportunities/opportunities.service";
import { opportunityKeys } from "./opportunity-query-keys";

export function useOpportunityDetails(opportunityId?: string, enabled = true) {
  return useQuery({
    queryKey: opportunityKeys.detail(opportunityId),
    queryFn: () => opportunitiesService.getOpportunity(opportunityId!),
    enabled: enabled && Boolean(opportunityId),
  });
}
