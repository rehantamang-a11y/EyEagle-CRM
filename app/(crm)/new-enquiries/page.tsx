import { Suspense } from "react";
import { CrmPage } from "@/components/crm/crm-page";
import { CrmLoading } from "@/components/crm/crm-loading";

export default function NewEnquiriesPage() {
  return <Suspense fallback={<CrmLoading label="Loading new enquiries" />}><CrmPage view="new-enquiries" /></Suspense>;
}
