"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { opportunitiesService } from "@/services/opportunities/opportunities.service";
import { opportunityKeys } from "./opportunity-query-keys";

export function useSyncJotform() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: opportunitiesService.syncJotform,
    onSuccess: async () => {
      await queryClient.refetchQueries({ queryKey: opportunityKeys.list("unclaimed"), type: "active" });
    },
  });
}
