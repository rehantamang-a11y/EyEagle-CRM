"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { CheckCircle2, Clock3, RefreshCw, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useMyWorkOpportunities } from "@/hooks/opportunities/use-my-work-opportunities";
import { useSalesOpportunities } from "@/hooks/opportunities/use-sales-opportunities";
import { useSaveOpportunityAction } from "@/hooks/opportunities/use-save-opportunity-action";
import { useSyncJotform } from "@/hooks/opportunities/use-sync-jotform";
import { useTakeOwnership } from "@/hooks/opportunities/use-take-ownership";
import { useUnclaimedOpportunities } from "@/hooks/opportunities/use-unclaimed-opportunities";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { crmListHref, parseSalesFilter, SALES_FILTERS, type CrmView } from "@/lib/crm-routes";
import { formatIndianPhone } from "@/lib/format-phone";
import type { Opportunity, OpportunityActionOutcome } from "@/services/opportunities/opportunities.types";

const titles: Record<CrmView, { title: string; description: string }> = {
  "new-enquiries": { title: "New enquiries", description: "Unclaimed Jotform submissions" },
  "my-work": { title: "My work", description: "Calls and follow-ups you own" },
  "all-sales": { title: "All sales", description: "Read-only view of who is handling what" },
};

const filterLabels = { ALL: "All", DUE: "Due", FOLLOW_UPS: "Follow-ups", CLOSED: "Closed" } as const;
const localDateTime = () => {
  const date = new Date(Date.now() + 86_400_000);
  date.setHours(11, 0, 0, 0);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
};
const backendLocalDateTime = (value: string) => value.length === 16 ? `${value}:00` : value.slice(0, 19);
const formatDate = (value?: string | null) => value
  ? new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }).format(new Date(value))
  : "—";
const formatAge = (value: string) => {
  const timestamp = new Date(value).getTime();
  if (!value || Number.isNaN(timestamp)) return "Time not provided";
  const hours = Math.max(0, Math.round((Date.now() - timestamp) / 3_600_000));
  return hours < 1 ? "Just now" : hours < 24 ? `${hours}h ago` : `${Math.floor(hours / 24)}d ago`;
};
const initials = (value?: string | null) => (value || "Unnamed enquiry").split(/\s+/).filter(Boolean).map((part) => part[0]).slice(0, 2).join("").toUpperCase() || "?";
const formAnswers = (item: Opportunity) => (item.formContext.formAnswers as Record<string, unknown> | undefined) || {};
const formValue = (item: Opportunity, terms: string[]) => {
  const entry = Object.entries(formAnswers(item)).find(([label]) => terms.some((term) => label.toLowerCase().includes(term.toLowerCase())));
  if (!entry) return "—";
  return Array.isArray(entry[1]) ? entry[1].join(", ") : String(entry[1] || "—");
};

function statusLabel(item: Opportunity) {
  if (item.status === "won") return "Sold";
  if (item.status === "lost") return "Not proceeding";
  if (item.workGroup === "DUE") return "Due";
  if (item.workGroup === "FOLLOW_UPS") return "Follow-up";
  if (item.workGroup === "CLOSED") return "Closed";
  return !item.nextActionAt || new Date(item.nextActionAt) <= new Date() ? "Due" : "Open";
}

export function CrmPage({ view }: { view: CrmView }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const paramsString = searchParams.toString();
  const urlSearch = searchParams.get("q")?.trim() || "";
  const rawFilter = searchParams.get("filter");
  const filter = parseSalesFilter(rawFilter);
  const [searchDraft, setSearchDraft] = useState(urlSearch);
  const [actionTarget, setActionTarget] = useState<Opportunity | null>(null);
  const [actionType, setActionType] = useState<OpportunityActionOutcome>("FOLLOW_UP");
  const [note, setNote] = useState("");
  const [nextActionAt, setNextActionAt] = useState(localDateTime());
  const [lostReason, setLostReason] = useState("Not interested");
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState("");
  const skipDebouncedNavigation = useRef(false);
  const debouncedSearch = useDebouncedValue(searchDraft.trim(), 1_500);
  const isSearchDebouncing = searchDraft.trim() !== urlSearch;
  const isNew = view === "new-enquiries";
  const isMyWork = view === "my-work";

  useEffect(() => {
    if (searchDraft.trim() === urlSearch) return;
    skipDebouncedNavigation.current = true;
    setSearchDraft(urlSearch);
  // URL navigation is authoritative; searchDraft intentionally stays out of this dependency list.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urlSearch, pathname]);

  useEffect(() => {
    if (skipDebouncedNavigation.current) {
      if (debouncedSearch !== urlSearch) return;
      skipDebouncedNavigation.current = false;
      return;
    }
    if (debouncedSearch === urlSearch) return;
    const params = new URLSearchParams(paramsString);
    if (debouncedSearch) params.set("q", debouncedSearch); else params.delete("q");
    router.replace(`${pathname}${params.size ? `?${params}` : ""}`, { scroll: false });
  }, [debouncedSearch, paramsString, pathname, router, urlSearch]);

  useEffect(() => {
    if (isNew || rawFilter === filter) return;
    router.replace(crmListHref(view, filter, urlSearch), { scroll: false });
  }, [filter, isNew, rawFilter, router, urlSearch, view]);

  const unclaimedQuery = useUnclaimedOpportunities(isNew);
  const myWorkQuery = useMyWorkOpportunities(isMyWork);
  const salesQuery = useSalesOpportunities(
    filter,
    urlSearch,
    view === "all-sales" && !isSearchDebouncing,
  );
  const syncJotform = useSyncJotform();
  const takeOwnership = useTakeOwnership();
  const saveOpportunityAction = useSaveOpportunityAction();
  const activeQuery = isNew ? unclaimedQuery : isMyWork ? myWorkQuery : salesQuery;
  const sourceRows = isNew ? (unclaimedQuery.data || []) : isMyWork ? (myWorkQuery.data || []) : (salesQuery.data || []);
  const rows = useMemo(() => {
    if (isNew) {
      return sourceRows.filter((item) => [item.fullName, item.phone, item.location, item.interest, item.summary]
        .filter(Boolean).join(" ").toLowerCase().includes(urlSearch.toLowerCase()))
        .sort((a, b) => new Date(a.submittedAt).getTime() - new Date(b.submittedAt).getTime());
    }
    if (!isMyWork) return sourceRows;
    const search = urlSearch.toLowerCase();
    return sourceRows.filter((item) => (filter === "ALL" || item.workGroup === filter)
      && [item.fullName, item.nextActionLabel, statusLabel(item)]
        .filter(Boolean).join(" ").toLowerCase().includes(search));
  }, [filter, isMyWork, isNew, sourceRows, urlSearch]);

  const flash = (message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(""), 2_800);
  };
  const setFilter = (nextFilter: typeof filter) => router.push(crmListHref(view, nextFilter, searchDraft), { scroll: false });
  const openDetail = (item: Opportunity, tab: "form" | "history" = "form") => {
    const params = new URLSearchParams({ source: view, tab });
    router.push(`/opportunities/${encodeURIComponent(item.id)}?${params}`);
  };
  const refresh = async () => {
    setBusy(true);
    try {
      const result = await syncJotform.mutateAsync();
      flash(`Jotform synced · ${result.imported ?? 0} new`);
    } catch (error) {
      flash(error instanceof Error ? error.message : "Could not sync Jotform submissions.");
    } finally { setBusy(false); }
  };
  const claim = async (item: Opportunity) => {
    setBusy(true);
    try {
      await takeOwnership.mutateAsync(item.id);
      flash(`Ownership taken for ${item.fullName}.`);
    } catch (error) {
      flash(error instanceof Error ? error.message : "Could not take ownership.");
    } finally { setBusy(false); }
  };
  const startAction = (item: Opportunity) => {
    setActionTarget(item);
    setActionType("FOLLOW_UP");
    setNote("");
    setNextActionAt(localDateTime());
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
      setActionTarget(null);
      const destinationFilter = actionType === "FOLLOW_UP" ? "FOLLOW_UPS" : "CLOSED";
      router.push(crmListHref("my-work", destinationFilter));
      flash(actionType === "FOLLOW_UP" ? "Saved in Follow-ups." : "Outcome saved in Closed.");
    } catch (error) {
      flash(error instanceof Error ? error.message : "Could not save the action.");
    } finally { setBusy(false); }
  };

  const loading = isSearchDebouncing || activeQuery.isFetching;
  const error = activeQuery.isError ? activeQuery.error : null;
  const heading = titles[view];

  return <>
    <section className="workspace">
      <div className="page-heading">
        <div><h1>{heading.title}</h1><p>{heading.description}</p></div>
        {isNew && <Button variant="outline" size="sm" onClick={() => void refresh()} disabled={busy}><RefreshCw size={14} className={busy ? "spin" : ""} />Refresh Jotform</Button>}
      </div>

      <div className="queue-toolbar">
        {!isNew
          ? <div className="simple-filters">{SALES_FILTERS.map((value) => <button key={value} className={filter === value ? "active" : ""} onClick={() => setFilter(value)}>{filterLabels[value]}</button>)}</div>
          : <span className="queue-scope">{unclaimedQuery.data?.length || 0} waiting for ownership</span>}
        <label className="desk-search"><Search size={14} /><span className="sr-only">Search {heading.title.toLowerCase()}</span><Input value={searchDraft} onChange={(event) => setSearchDraft(event.target.value)} placeholder={`Search ${heading.title.toLowerCase()}`} /></label>
      </div>

      {isSearchDebouncing && <div className="desk-empty"><Clock3 size={27} /><strong>Waiting for your search</strong></div>}
      {!isSearchDebouncing && loading && <div className="desk-empty"><RefreshCw className="spin" size={27} /><strong>Loading {heading.title.toLowerCase()}</strong><span>Fetching opportunities from the CRM.</span></div>}
      {!isSearchDebouncing && error && <div className="desk-empty"><strong>Could not load {heading.title}</strong><span>{error instanceof Error ? error.message : "The request failed."}</span><Button className="mt-3" variant="outline" size="sm" onClick={() => void activeQuery.refetch()}>Try again</Button></div>}

      <div className={loading || Boolean(error) ? "hidden" : ""}>
        <div className="queue-list">
          <div className={`queue-head ${isNew ? "intake-grid" : "minimal-grid"}`}>
            {isNew ? <><span>Customer</span><span>Interested in</span><span>Considering for</span><span>Main concern</span><span>Preferred callback</span><span>Submitted</span><span /></> : <><span>{view === "all-sales" ? "Customer / owner" : "Customer"}</span><span>Sales next action</span><span>Last update</span><span>Status</span><span /></>}
          </div>
          {rows.map((item) => <div className={`queue-row ${isNew ? "intake-grid" : "minimal-grid"}`} key={item.id}>
            <button className="customer-cell" onClick={() => openDetail(item)}><span className="customer-avatar">{initials(item.fullName)}</span><span><strong>{item.fullName || "Unnamed enquiry"}</strong><small>{item.location || "Location not provided"} · {formatIndianPhone(item.phone)}</small>{view === "all-sales" && <em className="owner-inline">Owner · {item.ownerName || "Unknown"}</em>}</span></button>
            {isNew ? <>
              <button className="minimal-context" onClick={() => openDetail(item)}><strong>{item.interest || formValue(item, ["what would you like next"])}</strong></button>
              <button className="minimal-context" onClick={() => openDetail(item)}><strong>{formValue(item, ["considering eyeagle"])}</strong></button>
              <button className="minimal-context" onClick={() => openDetail(item)}><strong>{formValue(item, ["main safety concern"])}</strong></button>
              <button className="minimal-context" onClick={() => openDetail(item)}><strong>{formValue(item, ["preferred time to contact"])}</strong><small>{formValue(item, ["timings"])}</small></button>
              <span className="minimal-meta">{formatAge(item.submittedAt)}</span>
              <div className="row-action"><Button size="sm" onClick={() => void claim(item)} disabled={busy}>Take ownership</Button></div>
            </> : <>
              <button className="minimal-context" onClick={() => openDetail(item)}><strong>{item.nextActionLabel || statusLabel(item)}</strong><small>{item.nextActionAt ? formatDate(item.nextActionAt) : item.lostReason || "Ready now"}</small></button>
              <span className="minimal-meta">{formatDate(item.lastActionAt || item.closedAt)}</span>
              <span className={`minimal-status ${statusLabel(item).toLowerCase().replace(" ", "-")}`}>{statusLabel(item)}</span>
              <div className="row-action">{view === "all-sales"
                ? <Button variant="ghost" size="sm" onClick={() => openDetail(item)}>View</Button>
                : item.status === "open"
                  ? <Button size="sm" onClick={() => startAction(item)}>Take action</Button>
                  : <Button variant="ghost" size="sm" onClick={() => openDetail(item, "history")}>View history</Button>}</div>
            </>}
          </div>)}
          {!rows.length && <div className="desk-empty"><CheckCircle2 size={27} /><strong>{urlSearch ? "No matching opportunities" : isNew ? "No new enquiries" : "Nothing here right now"}</strong>{(urlSearch || isNew) && <span>{urlSearch ? `No results for “${urlSearch}”.` : "Refresh Jotform when you are ready."}</span>}</div>}
        </div>
      </div>
    </section>

    <Dialog open={Boolean(actionTarget)} onOpenChange={(open) => !open && setActionTarget(null)}>
      <DialogContent>
        <DialogHeader><DialogTitle>Take action</DialogTitle><DialogDescription>Record what happened offline with {actionTarget?.fullName}.</DialogDescription></DialogHeader>
        <div className="minimal-form">
          <label>Outcome<Select value={actionType} onChange={(event) => setActionType(event.target.value as OpportunityActionOutcome)}><option value="FOLLOW_UP">Follow up</option><option value="SOLD">Sold</option><option value="NOT_PROCEEDING">Not proceeding</option></Select></label>
          {actionType === "FOLLOW_UP" && <label>Next follow-up<Input className="date-time-input" type="datetime-local" value={nextActionAt} onClick={(event) => event.currentTarget.showPicker?.()} onChange={(event) => setNextActionAt(event.target.value)} /></label>}
          {actionType === "NOT_PROCEEDING" && <label>Reason<Select value={lostReason} onChange={(event) => setLostReason(event.target.value)}><option>Not interested</option><option>Price</option><option>Chose another option</option><option>Invalid contact</option><option>Other</option></Select></label>}
          <label>Call summary<Textarea value={note} onChange={(event) => setNote(event.target.value)} placeholder="What did you discuss?" /></label>
        </div>
        <DialogFooter><Button variant="outline" onClick={() => setActionTarget(null)}>Cancel</Button><Button onClick={() => void saveAction()} disabled={busy}>{actionType === "FOLLOW_UP" ? "Save follow-up" : "Save outcome"}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
    {toast && <div className="toast">{toast}</div>}
  </>;
}
