import { Suspense } from "react";
import { CrmPage } from "@/components/crm/crm-page";
import { CrmLoading } from "@/components/crm/crm-loading";

export default function MyWorkPage() {
  return <Suspense fallback={<CrmLoading label="Loading My Work" />}><CrmPage view="my-work" /></Suspense>;
}
