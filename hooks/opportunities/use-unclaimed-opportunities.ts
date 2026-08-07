"use client";

import { useQuery } from "@tanstack/react-query";
import { opportunitiesService } from "@/services/opportunities/opportunities.service";
import { opportunityKeys } from "./opportunity-query-keys";

export function useUnclaimedOpportunities(enabled = true) {
  return useQuery({
    queryKey: opportunityKeys.list("unclaimed"),
    queryFn: opportunitiesService.listUnclaimed,
    enabled,
  });
}
