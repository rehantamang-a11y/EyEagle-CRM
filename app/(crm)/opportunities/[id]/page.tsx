import { Suspense } from "react";
import { OpportunityDetail } from "@/components/crm/opportunity-detail";
import { CrmLoading } from "@/components/crm/crm-loading";

export default async function OpportunityPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ source?: string }> }) {
  const { id } = await params;
  const { source = "all-sales" } = await searchParams;
  return <Suspense fallback={<CrmLoading label="Loading opportunity" />}><OpportunityDetail opportunityId={id} source={source} /></Suspense>;
}
