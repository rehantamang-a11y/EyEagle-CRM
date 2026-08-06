"use client";

import { useQuery } from "@tanstack/react-query";
import { opportunitiesService } from "@/services/opportunities/opportunities.service";
import { opportunityKeys } from "./use-unclaimed-opportunities";

export function useOpportunityActionHistory(opportunityId?: string, enabled = true) {
  return useQuery({
    queryKey: [...opportunityKeys.all, "detail", opportunityId, "actions"],
    queryFn: () => opportunitiesService.listActionHistory(opportunityId!),
    enabled: enabled && Boolean(opportunityId),
  });
}
