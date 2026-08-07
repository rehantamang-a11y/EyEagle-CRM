export const opportunityKeys = {
  all: ["opportunities"] as const,
  list: (view: string) => [...opportunityKeys.all, "list", view] as const,
  myWork: () => [...opportunityKeys.all, "list", "my-work"] as const,
  salesLists: () => [...opportunityKeys.all, "sales-list"] as const,
  salesList: (filter: string, search: string) =>
    [...opportunityKeys.salesLists(), filter, search] as const,
  detail: (opportunityId?: string) => [...opportunityKeys.all, "detail", opportunityId] as const,
  actionHistory: (opportunityId?: string) => [...opportunityKeys.detail(opportunityId), "actions"] as const,
};
