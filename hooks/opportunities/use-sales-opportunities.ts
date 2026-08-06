"use client";

import { useQuery } from "@tanstack/react-query";
import { opportunitiesService } from "@/services/opportunities/opportunities.service";
import type { SalesOpportunityFilter } from "@/services/opportunities/opportunities.types";
import { opportunityKeys } from "./use-unclaimed-opportunities";

type SalesTable = "my-work" | "all-sales";

export function useSalesOpportunities(
  consumer: SalesTable,
  filter: SalesOpportunityFilter,
  search: string,
  enabled = true,
) {
  return useQuery({
    queryKey: opportunityKeys.salesList(consumer, filter, search),
    queryFn: () => opportunitiesService.listSales(filter, search),
    enabled,
    staleTime: 0,
    gcTime: 0,
    refetchOnMount: "always",
    refetchOnReconnect: "always",
    refetchOnWindowFocus: "always",
  });
}
