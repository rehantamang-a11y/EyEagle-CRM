import { Suspense } from "react";
import { CrmPage } from "@/components/crm/crm-page";
import { CrmLoading } from "@/components/crm/crm-loading";

export default function AllSalesPage() {
  return <Suspense fallback={<CrmLoading label="Loading All Sales" />}><CrmPage view="all-sales" /></Suspense>;
}
