"use client";

import { useQuery } from "@tanstack/react-query";
import { opportunitiesService } from "@/services/opportunities/opportunities.service";
import { opportunityKeys } from "./use-unclaimed-opportunities";

export function useMyWorkOpportunities(enabled = true) {
  return useQuery({
    queryKey: opportunityKeys.list("my-work"),
    queryFn: opportunitiesService.listMyWork,
    enabled,
  });
}
