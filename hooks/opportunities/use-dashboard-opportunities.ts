"use client";

import { useQuery } from "@tanstack/react-query";
import { opportunitiesService } from "@/services/opportunities/opportunities.service";
import { opportunityKeys } from "./opportunity-query-keys";

export function useDashboardOpportunities(enabled = true) {
  return useQuery({
    queryKey: opportunityKeys.dashboard(),
    queryFn: ({ signal }) => opportunitiesService.listDashboardOpportunities(signal),
    enabled,
    staleTime: 0,
  });
}
