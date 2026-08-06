"use client";

import { useQuery } from "@tanstack/react-query";
import { opportunitiesService } from "@/services/opportunities/opportunities.service";

export const opportunityKeys = {
  all: ["opportunities"] as const,
  list: (view: string) => [...opportunityKeys.all, "list", view] as const,
};

export function useUnclaimedOpportunities(enabled = true) {
  return useQuery({
    queryKey: opportunityKeys.list("unclaimed"),
    queryFn: opportunitiesService.listUnclaimed,
    enabled,
  });
}
