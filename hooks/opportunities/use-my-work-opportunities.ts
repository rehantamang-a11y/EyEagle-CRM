"use client";

import { useQuery } from "@tanstack/react-query";
import { opportunitiesService } from "@/services/opportunities/opportunities.service";
import { opportunityKeys } from "./opportunity-query-keys";

export function useMyWorkOpportunities(enabled = true) {
  return useQuery({
    queryKey: opportunityKeys.myWork(),
    queryFn: opportunitiesService.listMyWork,
    enabled,
    staleTime: 0,
    refetchOnMount: "always",
    refetchOnReconnect: "always",
    refetchOnWindowFocus: "always",
  });
}
