"use client";

import { useMemo, useState } from "react";
import { Check, CheckCircle2, ClipboardList, Clock3, FileText, Inbox, RefreshCw, Search, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { SessionSummary } from "@/components/auth/session-summary";
import { useSyncJotform } from "@/hooks/opportunities/use-sync-jotform";
import { useTakeOwnership } from "@/hooks/opportunities/use-take-ownership";
import { useUnclaimedOpportunities } from "@/hooks/opportunities/use-unclaimed-opportunities";
import { useSaveOpportunityAction } from "@/hooks/opportunities/use-save-opportunity-action";
import { useOpportunityActionHistory } from "@/hooks/opportunities/use-opportunity-action-history";
import { useOpportunityDetails } from "@/hooks/opportunities/use-opportunity-details";
import { useSalesOpportunities } from "@/hooks/opportunities/use-sales-opportunities";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import type { Opportunity as CrmOpportunity, SalesOpportunityFilter } from "@/services/opportunities/opportunities.types";

type View = "new" | "work" | "all";
type WorkFilter = "all" | "due" | "follow_ups" | "closed";
type ActionType = "FOLLOW_UP" | "SOLD" | "NOT_PROCEEDING";
const formatDate = (value?: string | null) => value ? new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }).format(new Date(value)) : "—";
const formatAge = (value: string) => {
  const timestamp = new Date(value).getTime();
  if (!value || Number.isNaN(timestamp)) return "Time not provided";
  const hours = Math.max(0, Math.round((Date.now() - timestamp) / 3_600_000));
  return hours < 1 ? "Just now" : hours < 24 ? `${hours}h ago` : `${Math.floor(hours / 24)}d ago`;
};
const localDateTime = () => {
  const date = new Date(Date.now() + 86_400_000);
  date.setHours(11, 0, 0, 0);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
};
const backendLocalDateTime = (value: string) => value.length === 16 ? `${value}:00` : value.slice(0, 19);
const customerInitials = (value?: string | null) => (value || "Unnamed enquiry").split(/\s+/).filter(Boolean).map((part) => part[0]).slice(0, 2).join("").toUpperCase() || "?";
const submissionEntries = (item: CrmOpportunity) => Object.entries((item.formContext.formAnswers as Record<string, unknown> | undefined) || item.formContext)
  .filter(([key]) => !["formAnswers", "submittedAt", "source", "priority"].includes(key))
  .map(([label, value]) => [label, Array.isArray(value) ? value.join(", ") : String(value || "—")] as const);
const contactLabels = new Set(["Your Name", "Phone Number / Whatsapp No.", "Site name or location"]);
const choiceFields: Record<string, { type: "checkbox" | "radio"; options: string[] }> = {
  "Who are you considering EyEagle for?": { type: "checkbox", options: ["Senior parent / grandparent living in the same home", "Senior parent / grandparent living away", "Someone recovering from illness or surgery", "Pregnant family member", "Person living alone", "General home safety", "Other"] },
  "What is your main safety concern?": { type: "checkbox", options: ["Bathroom slips or falls", "No one nearby during emergency", "Elderly person alone at home", "Night-time bathroom use", "Need bathroom grab bars / support", "Need emergency alert system", "Not sure, just exploring"] },
  "Any immediate safety concern?": { type: "radio", options: ["Yes", "No"] },
  "What would you like next?": { type: "radio", options: ["Book a bathroom safety assessment", "Understand the EyEagle safety kit", "Get pricing details", "Just share information for now"] },
  "Preferred time to contact": { type: "radio", options: ["Tomorrow", "Day After Tomorrow", "This weekend"] },
  "Timings": { type: "radio", options: ["Morning", "Afternoon", "Evening"] },
};
const submissionField = ([label, value]: readonly [string, string]) => {
  const choices = choiceFields[label]; const selected = value.split(", ").filter(Boolean); const wide = value.length > 68 || /concern|brief description/i.test(label);
  if (choices) return <div className={`submitted-choice ${wide ? "is-wide" : ""}`} key={label}><div className="response-label"><span>{label}</span>{choices.type === "checkbox" && selected.length > 1 && <small>{selected.length} selected</small>}</div><div className="selected-responses">{selected.map((option) => <span key={option}><i className={choices.type}><Check size={11} strokeWidth={3} /></i>{option}</span>)}</div></div>;
  return <div className={`submitted-text ${wide ? "is-wide" : ""}`} key={label}><span>{label}</span><strong>{value}</strong></div>;
};
const formValue = (item: CrmOpportunity, terms: string[]) => {
  const entry = submissionEntries(item).find(([label]) => terms.some((term) => label.toLowerCase().includes(term)));
  return entry?.[1] || "—";
};

function statusLabel(item: CrmOpportunity) {
  if (item.status === "won") return "Sold";
  if (item.status === "lost") return "Not proceeding";
  if (item.workGroup === "DUE") return "Due";
  if (item.workGroup === "FOLLOW_UPS") return "Follow-up";
  if (item.workGroup === "CLOSED") return "Closed";
  return !item.nextActionAt || new Date(item.nextActionAt) <= new Date() ? "Due" : "Open";
}

export function CRMApp() {
  const [view, setView] = useState<View>("new");
  const [filter, setFilter] = useState<WorkFilter>("all");
  const [search, setSearch] = useState("");
  const [detail, setDetail] = useState<CrmOpportunity | null>(null);
  const [detailTab, setDetailTab] = useState<"form" | "history">("form");
  const [actionTarget, setActionTarget] = useState<CrmOpportunity | null>(null);
  const [actionType, setActionType] = useState<ActionType>("FOLLOW_UP");
  const [note, setNote] = useState(""); const [nextActionAt, setNextActionAt] = useState(localDateTime()); const [lostReason, setLostReason] = useState("Not interested");
  const [busy, setBusy] = useState(false); const [toast, setToast] = useState("");
  const unclaimedQuery = useUnclaimedOpportunities(view === "new");
  const salesFilter: SalesOpportunityFilter = filter === "follow_ups" ? "FOLLOW_UPS" : filter.toUpperCase() as SalesOpportunityFilter;
  const salesSearch = view === "new" ? "" : search.trim();
  const debouncedSearch = useDebouncedValue(salesSearch, 1_500);
  const isSearchDebouncing = view !== "new" && salesSearch !== debouncedSearch;
  const myWorkQuery = useSalesOpportunities("my-work", salesFilter, debouncedSearch, view === "work" && !isSearchDebouncing);
  const allSalesQuery = useSalesOpportunities("all-sales", salesFilter, debouncedSearch, view === "all" && !isSearchDebouncing);
  const syncJotform = useSyncJotform();
  const takeOwnership = useTakeOwnership();
  const saveOpportunityAction = useSaveOpportunityAction();
  const showActivityHistory = Boolean(detail && (view === "all" || (view === "work" && detail.workGroup === "CLOSED")));
  const opportunityDetailQuery = useOpportunityDetails(detail?.id, Boolean(detail) && view !== "new");
  const actionHistoryQuery = useOpportunityActionHistory(detail?.id, showActivityHistory);
  const modalDetail = opportunityDetailQuery.data || detail;
  const detailHistory = actionHistoryQuery.data || detail?.history || [];
  const flash = (message: string) => { setToast(message); window.setTimeout(() => setToast(""), 2800); };
  const visibleItems = view === "new"
    ? (unclaimedQuery.data || [])
    : view === "work"
      ? (myWorkQuery.data || [])
      : (allSalesQuery.data || []);
  const rows = useMemo(() => view === "new"
    ? visibleItems
      .filter((item) => [item.fullName, item.phone, item.location, item.interest, item.summary].filter(Boolean).join(" ").toLowerCase().includes(search.toLowerCase()))
      .sort((a, b) => new Date(a.submittedAt).getTime() - new Date(b.submittedAt).getTime())
    : visibleItems,
  [visibleItems, view, search]);
  const newCount = unclaimedQuery.data?.length || 0;
  const openCount = myWorkQuery.data?.filter((item) => item.status === "open").length || 0;
  const activeListQuery = view === "new" ? unclaimedQuery : view === "work" ? myWorkQuery : allSalesQuery;

  const refresh = async () => {
    setBusy(true);
    try {
      const result = await syncJotform.mutateAsync();
      const imported = result.imported ?? 0;
      const scanned = result.scanned;
      flash(scanned === undefined ? `Jotform synced · ${imported} new` : `Jotform synced · ${imported} imported from ${scanned}`);
    } catch (error) {
      flash(error instanceof Error ? error.message : "Could not sync Jotform submissions.");
    } finally {
      setBusy(false);
    }
  };
  const claim = async (item: CrmOpportunity) => {
    setBusy(true);
    try {
      await takeOwnership.mutateAsync(item.id);
      setDetail(null); flash(`Ownership taken for ${item.fullName}.`);
    } catch (error) { flash(error instanceof Error ? error.message : "Could not take ownership."); } finally { setBusy(false); }
  };
  const saveAction = async () => {
    if (!actionTarget || note.trim().length < 2) return flash("Add a short call summary first.");
    if (actionType === "FOLLOW_UP" && new Date(nextActionAt) <= new Date()) return flash("Choose a future follow-up time.");
    setBusy(true);
    try {
      await saveOpportunityAction.mutateAsync({
        opportunityId: actionTarget.id,
        outcome: actionType,
        nextFollowUp: actionType === "FOLLOW_UP" ? backendLocalDateTime(nextActionAt) : null,
        reason: actionType === "NOT_PROCEEDING" ? lostReason : null,
        callSummary: note.trim(),
      });
      setActionTarget(null); setView("work"); setFilter(actionType === "FOLLOW_UP" ? "follow_ups" : "closed"); flash(actionType === "FOLLOW_UP" ? "Saved in Follow-ups." : "Outcome saved in Closed.");
    } catch (error) { flash(error instanceof Error ? error.message : "Could not save the action."); } finally { setBusy(false); }
  };
  const openDetail = async (item: CrmOpportunity, tab: "form" | "history" = "form") => {
    setDetailTab(tab); setDetail(item);
  };
  return <div className="desk-shell minimal-desk">
    <aside className="desk-sidebar"><div className="sidebar-brand"><span><img src="/logo.svg" alt="Eyeagle" /></span><div><strong>Eyeagle</strong><small>Sales desk</small></div></div><div className="sidebar-heading"><span>Work</span><small>Keep the next promise visible.</small></div><nav><button className={view === "new" ? "active" : ""} onClick={() => setView("new")}><span><Inbox size={16} />New enquiries</span><b>{newCount}</b></button><button className={view === "work" ? "active" : ""} onClick={() => setView("work")}><span><ClipboardList size={16} />My work</span><b>{openCount}</b></button><button className={view === "all" ? "active" : ""} onClick={() => setView("all")}><span><Users size={16} />All sales</span></button></nav><div className="sidebar-footer"><div className="sidebar-source"><FileText size={16} /><div><strong>Jotform intake</strong><small>Manual refresh only</small></div></div><SessionSummary /></div></aside>
    <main className="desk-frame"><div className="desk-main"><section className="workspace">
        <div className="page-heading"><div><h1>{view === "new" ? "New enquiries" : view === "work" ? "My work" : "All sales"}</h1><p>{view === "new" ? "Unclaimed Jotform submissions" : view === "work" ? "Calls and follow-ups you own" : "Read-only view of who is handling what"}</p></div>{view === "new" && <Button variant="outline" size="sm" onClick={refresh} disabled={busy}><RefreshCw size={14} className={busy ? "spin" : ""} />Refresh Jotform</Button>}</div>
        <div className="queue-toolbar">{view !== "new" ? <div className="simple-filters">{(["all", "due", "follow_ups", "closed"] as WorkFilter[]).map((value) => <button key={value} className={filter === value ? "active" : ""} onClick={() => setFilter(value)}>{value === "all" ? "All" : value === "due" ? "Due" : value === "follow_ups" ? "Follow-ups" : "Closed"}</button>)}</div> : <span className="queue-scope">{newCount} waiting for ownership</span>}<label className="desk-search"><Search size={14} /><span className="sr-only">{view === "new" ? "Search enquiries" : view === "work" ? "Search my work" : "Search all sales"}</span><Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder={view === "new" ? "Search enquiries" : view === "work" ? "Search my work" : "Search all sales"} /></label></div>
        {view === "new" && unclaimedQuery.isLoading && <div className="desk-empty"><RefreshCw className="spin" size={27} /><strong>Loading new enquiries</strong><span>Fetching unclaimed opportunities from the CRM.</span></div>}
        {view === "new" && unclaimedQuery.isError && <div className="desk-empty"><strong>Could not load new enquiries</strong><span>{unclaimedQuery.error instanceof Error ? unclaimedQuery.error.message : "The request failed."}</span><Button className="mt-3" variant="outline" size="sm" onClick={() => void unclaimedQuery.refetch()}>Try again</Button></div>}
        {isSearchDebouncing && <div className="desk-empty"><Clock3 size={27} /><strong>Waiting for your search</strong><span>Results will refresh shortly after you finish typing.</span></div>}
        {view === "work" && !isSearchDebouncing && myWorkQuery.isFetching && <div className="desk-empty"><RefreshCw className="spin" size={27} /><strong>Loading your work</strong><span>Fetching opportunities from the CRM.</span></div>}
        {view === "work" && !isSearchDebouncing && myWorkQuery.isError && <div className="desk-empty"><strong>Could not load My Work</strong><span>{myWorkQuery.error instanceof Error ? myWorkQuery.error.message : "The request failed."}</span><Button className="mt-3" variant="outline" size="sm" onClick={() => void myWorkQuery.refetch()}>Try again</Button></div>}
        {view === "all" && !isSearchDebouncing && allSalesQuery.isFetching && <div className="desk-empty"><RefreshCw className="spin" size={27} /><strong>Loading all sales</strong><span>Fetching opportunities from the CRM.</span></div>}
        {view === "all" && !isSearchDebouncing && allSalesQuery.isError && <div className="desk-empty"><strong>Could not load All Sales</strong><span>{allSalesQuery.error instanceof Error ? allSalesQuery.error.message : "The request failed."}</span><Button className="mt-3" variant="outline" size="sm" onClick={() => void allSalesQuery.refetch()}>Try again</Button></div>}
        <div className={isSearchDebouncing || (view !== "new" && activeListQuery.isFetching) ? "hidden" : ""}>
        <div className={`queue-list ${activeListQuery && (activeListQuery.isLoading || activeListQuery.isError) ? "hidden" : ""}`}><div className={`queue-head ${view === "new" ? "intake-grid" : "minimal-grid"}`}>{view === "new" ? <><span>Customer</span><span>Interested in</span><span>Considering for</span><span>Main concern</span><span>Preferred callback</span><span>Submitted</span><span></span></> : <><span>{view === "all" ? "Customer / owner" : "Customer"}</span><span>Sales next action</span><span>Last update</span><span>Status</span><span></span></>}</div>{rows.map((item) => <div className={`queue-row ${view === "new" ? "intake-grid" : "minimal-grid"}`} key={item.id}><button className="customer-cell" onClick={() => void openDetail(item)}><span className="customer-avatar">{customerInitials(item.fullName)}</span><span><strong>{item.fullName || "Unnamed enquiry"}</strong><small>{item.location || "Location not provided"} · {item.phone || "Phone not provided"}</small>{view === "all" && <em className="owner-inline">Owner · {item.ownerName || "Unknown"}</em>}</span></button>{view === "new" ? <><button className="minimal-context" onClick={() => void openDetail(item)}><strong>{item.interest || formValue(item, ["what would you like next"])}</strong></button><button className="minimal-context" onClick={() => void openDetail(item)}><strong>{formValue(item, ["considering eyEagle".toLowerCase()])}</strong></button><button className="minimal-context" onClick={() => void openDetail(item)}><strong>{formValue(item, ["main safety concern"])}</strong></button><button className="minimal-context" onClick={() => void openDetail(item)}><strong>{formValue(item, ["preferred time to contact"])}</strong><small>{formValue(item, ["timings"])}</small></button><span className="minimal-meta">{formatAge(item.submittedAt)}</span><div className="row-action"><Button size="sm" onClick={() => void claim(item)} disabled={busy}>Take ownership</Button></div></> : <><button className="minimal-context" onClick={() => void openDetail(item)}><strong>{item.nextActionLabel || statusLabel(item)}</strong><small>{item.nextActionAt ? formatDate(item.nextActionAt) : item.lostReason || "Ready now"}</small></button><span className="minimal-meta">{formatDate(item.lastActionAt || item.closedAt)}</span><span className={`minimal-status ${statusLabel(item).toLowerCase().replace(" ", "-")}`}>{statusLabel(item)}</span><div className="row-action">{view === "all" ? <Button variant="ghost" size="sm" onClick={() => void openDetail(item)}>View</Button> : item.status === "open" ? <Button size="sm" onClick={() => { setActionTarget(item); setActionType("FOLLOW_UP"); setNote(""); setNextActionAt(localDateTime()); }}>Take action</Button> : <Button variant="ghost" size="sm" onClick={() => void openDetail(item, "history")}>View history</Button>}</div></>}</div>)}{!activeListQuery?.isLoading && !activeListQuery?.isError && rows.length === 0 && <div className="desk-empty"><CheckCircle2 size={27} /><strong>{view === "new" ? "No new enquiries" : view === "all" && search.trim() ? "No matching sales" : "Nothing here right now"}</strong><span>{view === "new" ? "Refresh Jotform when you are ready." : view === "all" && search.trim() ? `No results for “${search.trim()}”.` : view === "all" ? "No sales opportunities are available." : "Scheduled follow-ups remain visible here until they become due."}</span></div>}</div>
        </div>
      </section></div></main>
    <Dialog open={Boolean(actionTarget)} onOpenChange={(open) => !open && setActionTarget(null)}><DialogContent><DialogHeader><DialogTitle>Take action</DialogTitle><DialogDescription>Record what happened offline with {actionTarget?.fullName}.</DialogDescription></DialogHeader><div className="minimal-form"><label>Outcome<Select value={actionType} onChange={(event) => setActionType(event.target.value as ActionType)}><option value="FOLLOW_UP">Follow up</option><option value="SOLD">Sold</option><option value="NOT_PROCEEDING">Not proceeding</option></Select></label>{actionType === "FOLLOW_UP" && <label>Next follow-up<Input className="date-time-input" type="datetime-local" value={nextActionAt} onClick={(event) => event.currentTarget.showPicker?.()} onChange={(event) => setNextActionAt(event.target.value)} /></label>}{actionType === "NOT_PROCEEDING" && <label>Reason<Select value={lostReason} onChange={(event) => setLostReason(event.target.value)}><option>Not interested</option><option>Price</option><option>Chose another option</option><option>Invalid contact</option><option>Other</option></Select></label>}<label>Call summary<Textarea value={note} onChange={(event) => setNote(event.target.value)} placeholder="What did you discuss?" /></label></div><DialogFooter><Button variant="outline" onClick={() => setActionTarget(null)}>Cancel</Button><Button onClick={() => void saveAction()} disabled={busy}>{actionType === "FOLLOW_UP" ? "Save follow-up" : "Save outcome"}</Button></DialogFooter></DialogContent></Dialog>
    <Dialog open={Boolean(detail)} onOpenChange={(open) => !open && setDetail(null)}><DialogContent className="detail-dialog"><DialogHeader><DialogTitle>{modalDetail?.fullName}</DialogTitle><DialogDescription>{modalDetail?.phone}{modalDetail?.location ? ` · ${modalDetail.location}` : ""}</DialogDescription>{modalDetail && <div className="submission-meta"><span>Submitted · {formatDate(modalDetail.submittedAt)}</span><span>Jotform</span></div>}</DialogHeader>{modalDetail && <div className="detail-content">{view === "new" && modalDetail.status === "new" ? <section className="ownership-section"><div><h3>Ownership</h3><strong>Unclaimed enquiry</strong><p>Take ownership when you are ready to make the first call.</p></div><Button onClick={() => void claim(modalDetail)} disabled={busy}>Take ownership</Button></section> : <section><h3>Sales next action</h3><strong>{modalDetail.nextActionLabel || statusLabel(modalDetail)}</strong><p>{modalDetail.nextActionAt ? formatDate(modalDetail.nextActionAt) : modalDetail.lastNote || "No further action."}</p></section>}<div className="detail-tabs" role="tablist" aria-label="Enquiry details"><button role="tab" aria-selected={detailTab === "form"} onClick={() => setDetailTab("form")}>Form submission</button>{showActivityHistory && <button role="tab" aria-selected={detailTab === "history"} onClick={() => setDetailTab("history")}>Activity history <span>{actionHistoryQuery.isLoading ? "…" : detailHistory.length}</span></button>}</div>{detailTab === "form" ? <section className="detail-tab-panel" role="tabpanel">{opportunityDetailQuery.isLoading ? <p>Loading opportunity details…</p> : opportunityDetailQuery.isError ? <div><p>{opportunityDetailQuery.error instanceof Error ? opportunityDetailQuery.error.message : "Could not load opportunity details."}</p><Button className="mt-3" variant="outline" size="sm" onClick={() => void opportunityDetailQuery.refetch()}>Try again</Button></div> : <><p className="form-context-note">Read-only form responses, exactly as submitted.</p><div className="submission-group"><span>Contact details</span><div className="submission-fields">{submissionEntries(modalDetail).filter(([label]) => contactLabels.has(label)).map(submissionField)}</div></div><div className="submission-group"><span>Form responses</span><div className="submission-fields">{submissionEntries(modalDetail).filter(([label]) => !contactLabels.has(label)).map(submissionField)}</div></div></>}</section> : showActivityHistory ? <section className="detail-tab-panel" role="tabpanel">{actionHistoryQuery.isLoading ? <p>Loading activity history…</p> : actionHistoryQuery.isError ? <div><p>{actionHistoryQuery.error instanceof Error ? actionHistoryQuery.error.message : "Could not load activity history."}</p><Button className="mt-3" variant="outline" size="sm" onClick={() => void actionHistoryQuery.refetch()}>Try again</Button></div> : detailHistory.length ? detailHistory.map((event) => <article className="history-line" key={event.id}><Clock3 size={14} /><div><strong>{event.type.replaceAll("_", " ")}</strong><p>{event.note || event.lostReason || "Updated"}{event.nextActionAt ? ` · Next: ${formatDate(event.nextActionAt)}` : ""}</p><small>{formatDate(event.at)}</small></div></article>) : <p>No activity yet.</p>}</section> : null}</div>}</DialogContent></Dialog>
    {toast && <div className="toast">{toast}</div>}
  </div>;
}
