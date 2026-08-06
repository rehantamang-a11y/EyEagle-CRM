"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { opportunitiesService } from "@/services/opportunities/opportunities.service";
import { opportunityKeys } from "./use-unclaimed-opportunities";

export function useTakeOwnership() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: opportunitiesService.takeOwnership,
    onSuccess: async () => {
      await Promise.all([
        queryClient.refetchQueries({ queryKey: opportunityKeys.list("unclaimed"), type: "active" }),
        queryClient.invalidateQueries({ queryKey: opportunityKeys.list("my-work") }),
      ]);
    },
  });
}
