import { Suspense } from "react";
import { OpportunityDetail } from "@/components/crm/opportunity-detail";

export default async function OpportunityModal({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ source?: string }> }) {
  const { id } = await params;
  const { source = "all-sales" } = await searchParams;
  return <Suspense fallback={null}><OpportunityDetail opportunityId={id} source={source} modal /></Suspense>;
}
