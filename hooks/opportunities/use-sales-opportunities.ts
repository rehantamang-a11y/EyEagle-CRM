"use client";

import { useQuery } from "@tanstack/react-query";
import { opportunitiesService } from "@/services/opportunities/opportunities.service";
import type { SalesOpportunityFilter } from "@/services/opportunities/opportunities.types";
import { opportunityKeys } from "./opportunity-query-keys";

export function useSalesOpportunities(
  filter: SalesOpportunityFilter,
  search: string,
  enabled = true,
) {
  return useQuery({
    queryKey: opportunityKeys.salesList(filter, search),
    queryFn: () => opportunitiesService.listSales(filter, search),
    enabled,
    staleTime: 0,
    gcTime: 0,
    refetchOnMount: "always",
    refetchOnReconnect: "always",
    refetchOnWindowFocus: "always",
  });
}
