"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, Clock3, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useOpportunityActionHistory } from "@/hooks/opportunities/use-opportunity-action-history";
import { useOpportunityDetails } from "@/hooks/opportunities/use-opportunity-details";
import { useTakeOwnership } from "@/hooks/opportunities/use-take-ownership";
import { formatIndianPhone } from "@/lib/format-phone";
import { OPPORTUNITY_CONTACT_LABELS } from "@/services/opportunities/opportunity-form";
import { opportunityStatusLabel } from "@/services/opportunities/opportunity-status";
import type { Opportunity } from "@/services/opportunities/opportunities.types";

const formatDate = (value?: string | null) => value
  ? new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(value))
  : "—";
const statusLabel = (item: Opportunity) => opportunityStatusLabel(item.status);
const entries = (item: Opportunity) => Object.entries(item.formAnswers)
  .map(([label, value]) => [label, Array.isArray(value) ? value.join(", ") : String(value || "—")] as const);
const contactLabels = new Set<string>(OPPORTUNITY_CONTACT_LABELS);

function DetailBody({ opportunityId, source }: { opportunityId: string; source: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const details = useOpportunityDetails(opportunityId, true);
  const isNewEnquiry = source === "new-enquiries";
  const requestedTab = searchParams.get("tab") === "history" ? "history" : "form";
  const tab = isNewEnquiry ? "form" : requestedTab;
  const history = useOpportunityActionHistory(opportunityId, !isNewEnquiry);
  const takeOwnership = useTakeOwnership();
  const [claimError, setClaimError] = useState("");

  const setTab = (nextTab: "form" | "history") => {
    const params = new URLSearchParams(searchParams.toString());
    params.set("tab", nextTab);
    router.replace(`?${params}`, { scroll: false });
  };
  const claim = async (item: Opportunity) => {
    setClaimError("");
    try {
      await takeOwnership.mutateAsync(item.id);
      router.back();
    } catch (error) {
      setClaimError(error instanceof Error ? error.message : "Could not take ownership.");
    }
  };

  if (details.isLoading) return <div className="desk-empty"><RefreshCw className="spin" size={27} /><strong>Loading opportunity</strong></div>;
  if (details.isError || !details.data) return <div className="desk-empty"><strong>Could not load opportunity</strong><span>{details.error instanceof Error ? details.error.message : "The opportunity was not found."}</span><Button variant="outline" size="sm" onClick={() => void details.refetch()}>Try again</Button></div>;

  const item = details.data;
  const submissionEntries = entries(item);
  const historyItems = history.data || [];

  return <>
    <DialogHeader>
      <DialogTitle>{item.fullName || "Unnamed enquiry"}</DialogTitle>
      <DialogDescription>{formatIndianPhone(item.phone)}{item.location ? ` · ${item.location}` : ""}</DialogDescription>
      <div className="submission-meta"><span>Submitted · {formatDate(item.submittedAt)}</span><span>{item.source || "Source not provided"}</span></div>
    </DialogHeader>
    <div className="detail-content">
      {isNewEnquiry
        ? <section className="ownership-section"><div><h3>Ownership</h3><strong>Unclaimed enquiry</strong><p>Take ownership when you are ready to make the first call.</p>{claimError && <p className="text-[var(--red)]">{claimError}</p>}</div><Button onClick={() => void claim(item)} disabled={takeOwnership.isPending}>Take ownership</Button></section>
        : <section><h3>Sales next action</h3><strong>{item.nextActionLabel || statusLabel(item)}</strong><p>{item.nextActionAt ? formatDate(item.nextActionAt) : "No further action."}</p></section>}

      <div className="detail-tabs" role="tablist" aria-label="Enquiry details">
        <button role="tab" aria-selected={tab === "form"} onClick={() => setTab("form")}>Form submission</button>
        {!isNewEnquiry && <button role="tab" aria-selected={tab === "history"} onClick={() => setTab("history")}>Activity history <span>{history.isLoading ? "…" : historyItems.length}</span></button>}
      </div>

      {tab === "form" ? <section className="detail-tab-panel" role="tabpanel">
        <p className="form-context-note">Read-only form responses, exactly as submitted.</p>
        <div className="submission-group"><span>Contact details</span><div className="submission-fields">{submissionEntries.filter(([label]) => contactLabels.has(label)).map(([label, value]) => <div className="submitted-text" key={label}><span>{label}</span><strong>{value}</strong></div>)}</div></div>
        <div className="submission-group"><span>Form responses</span><div className="submission-fields">{submissionEntries.filter(([label]) => !contactLabels.has(label)).map(([label, value]) => <div className={`submitted-text ${value.length > 68 ? "is-wide" : ""}`} key={label}><span>{label}</span><strong>{value}</strong></div>)}</div></div>
      </section> : <section className="detail-tab-panel" role="tabpanel">
        {history.isLoading ? <p>Loading activity history…</p> : history.isError ? <div><p>{history.error instanceof Error ? history.error.message : "Could not load activity history."}</p><Button variant="outline" size="sm" onClick={() => void history.refetch()}>Try again</Button></div> : historyItems.length ? historyItems.map((event) => <article className="history-line" key={event.id}><Clock3 size={14} /><div><strong>{event.type.replaceAll("_", " ")}</strong><p>{event.note || event.lostReason || "Updated"}{event.nextActionAt ? ` · Next: ${formatDate(event.nextActionAt)}` : ""}</p><small>{formatDate(event.at)}</small></div></article>) : <p>No activity yet.</p>}
      </section>}
    </div>
  </>;
}

export function OpportunityDetail({ opportunityId, source, modal = false }: { opportunityId: string; source: string; modal?: boolean }) {
  const router = useRouter();
  if (modal) return <Dialog open onOpenChange={(open) => !open && router.back()}><DialogContent className="detail-dialog"><DetailBody opportunityId={opportunityId} source={source} /></DialogContent></Dialog>;
  return <section className="workspace"><div className="page-heading"><div><h1>Opportunity details</h1><p>Authoritative CRM record and activity</p></div><Button variant="outline" size="sm" onClick={() => router.back()}><ArrowLeft size={14} />Back</Button></div><div className="detail-dialog route-detail"><DetailBody opportunityId={opportunityId} source={source} /></div></section>;
}
