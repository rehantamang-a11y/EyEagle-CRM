"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { opportunitiesService } from "@/services/opportunities/opportunities.service";
import type { OpportunityActionRequest } from "@/services/opportunities/opportunities.types";
import { opportunityKeys } from "./opportunity-query-keys";

type SaveOpportunityActionVariables = OpportunityActionRequest & {
  opportunityId: string;
};

export function useSaveOpportunityAction() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ opportunityId, ...action }: SaveOpportunityActionVariables) =>
      opportunitiesService.saveAction(opportunityId, action),
    onSuccess: async (_data, variables) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: opportunityKeys.myWork() }),
        queryClient.invalidateQueries({ queryKey: opportunityKeys.salesLists() }),
        queryClient.invalidateQueries({ queryKey: opportunityKeys.actionHistory(variables.opportunityId) }),
      ]);
    },
  });
}
