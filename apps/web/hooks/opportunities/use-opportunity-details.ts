"use client";

import { useQuery } from "@tanstack/react-query";
import { opportunitiesService } from "@/services/opportunities/opportunities.service";
import { opportunityKeys } from "./use-unclaimed-opportunities";

export function useOpportunityDetails(opportunityId?: string, enabled = true) {
  return useQuery({
    queryKey: [...opportunityKeys.all, "detail", opportunityId],
    queryFn: () => opportunitiesService.getOpportunity(opportunityId!),
    enabled: enabled && Boolean(opportunityId),
  });
}
