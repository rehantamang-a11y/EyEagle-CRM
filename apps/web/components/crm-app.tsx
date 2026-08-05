"use client";

import { useEffect, useMemo, useState } from "react";
import { Check, CheckCircle2, ClipboardList, Clock3, FileText, Inbox, RefreshCw, Search, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { minimalDemoData, type CrmOpportunity } from "@/lib/minimal-demo-data";

type View = "new" | "work" | "all";
type WorkFilter = "due" | "upcoming" | "closed";
type ActionType = "follow_up" | "sold" | "not_proceeding";
const apiBase = process.env.NEXT_PUBLIC_CRM_API_URL;
const formatDate = (value?: string | null) => value ? new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }).format(new Date(value)) : "—";
const formatAge = (value: string) => {
  const hours = Math.max(0, Math.round((Date.now() - new Date(value).getTime()) / 3_600_000));
  return hours < 1 ? "Just now" : hours < 24 ? `${hours}h ago` : `${Math.floor(hours / 24)}d ago`;
};
const localDateTime = () => { const date = new Date(Date.now() + 86_400_000); date.setHours(11, 0, 0, 0); return date.toISOString().slice(0, 16); };
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
  return item.nextActionAt && new Date(item.nextActionAt) <= new Date() ? "Due" : "Open";
}

export function CRMApp() {
  const [items, setItems] = useState<CrmOpportunity[]>(minimalDemoData);
  const [view, setView] = useState<View>("new");
  const [filter, setFilter] = useState<WorkFilter>("due");
  const [search, setSearch] = useState("");
  const [detail, setDetail] = useState<CrmOpportunity | null>(null);
  const [detailTab, setDetailTab] = useState<"form" | "history">("form");
  const [actionTarget, setActionTarget] = useState<CrmOpportunity | null>(null);
  const [actionType, setActionType] = useState<ActionType>("follow_up");
  const [note, setNote] = useState(""); const [nextActionAt, setNextActionAt] = useState(localDateTime()); const [lostReason, setLostReason] = useState("Not interested");
  const [busy, setBusy] = useState(false); const [toast, setToast] = useState("");
  const flash = (message: string) => { setToast(message); window.setTimeout(() => setToast(""), 2800); };
  const endpoint = view === "new" ? "new" : filter;
  const load = async (target = endpoint) => {
    if (!apiBase) return;
    const response = await fetch(`${apiBase}/crm/opportunities?view=${target}&scope=${view === "all" ? "all" : "mine"}`, { credentials: "include" });
    const body = await response.json() as { data?: CrmOpportunity[]; error?: { message?: string } };
    if (!response.ok) throw new Error(body.error?.message || "Could not load CRM records.");
    if (body.data) setItems(body.data.map((item) => ({ ...item, history: item.history || [] })));
  };
  useEffect(() => { void load().catch((error) => flash(error.message)); }, [view, filter]); // eslint-disable-line react-hooks/exhaustive-deps
  const rows = useMemo(() => items.filter((item) => {
    const matches = [item.fullName, item.phone, item.location, item.interest, item.summary].filter(Boolean).join(" ").toLowerCase().includes(search.toLowerCase());
    if (!matches) return false;
    if (view === "new") return item.status === "new";
    if (!apiBase && view === "work" && item.ownerUserId !== "me") return false;
    if (filter === "closed") return item.status === "won" || item.status === "lost";
    if (item.status !== "open" || !item.nextActionAt) return false;
    return filter === "due" ? new Date(item.nextActionAt) <= new Date() : new Date(item.nextActionAt) > new Date();
  }).sort((a, b) => view === "new" ? new Date(a.submittedAt).getTime() - new Date(b.submittedAt).getTime() : new Date(a.nextActionAt || a.closedAt || 0).getTime() - new Date(b.nextActionAt || b.closedAt || 0).getTime()), [items, view, filter, search]);
  const newCount = items.filter((item) => item.status === "new").length;
  const dueCount = items.filter((item) => item.status === "open" && item.nextActionAt && new Date(item.nextActionAt) <= new Date()).length;
  const openCount = items.filter((item) => item.status === "open" && (apiBase || item.ownerUserId === "me")).length;

  const refresh = async () => {
    if (!apiBase) return flash("Demo mode: add NEXT_PUBLIC_CRM_API_URL to connect Jotform.");
    setBusy(true);
    try { const response = await fetch(`${apiBase}/crm/jotform/sync`, { method: "POST", credentials: "include" }); const body = await response.json() as { data?: { scanned: number; imported: number; issues: number }; error?: { message?: string } }; if (!response.ok) throw new Error(body.error?.message || "Jotform refresh failed."); await load(); flash(`Jotform refreshed · ${body.data?.imported ?? 0} imported from ${body.data?.scanned ?? 0}`); }
    catch (error) { flash(error instanceof Error ? error.message : "Jotform refresh failed."); } finally { setBusy(false); }
  };
  const claim = async (item: CrmOpportunity) => {
    setBusy(true);
    try {
      if (apiBase) { const response = await fetch(`${apiBase}/crm/opportunities/${item.id}/claim`, { method: "POST", credentials: "include" }); const body = await response.json(); if (!response.ok) throw new Error(body.error?.message || "Could not take ownership."); await load("new"); }
      else setItems((current) => current.map((entry) => entry.id === item.id ? { ...entry, status: "open", ownerUserId: "me", nextActionAt: new Date().toISOString(), nextActionLabel: "Call customer", lastActionAt: new Date().toISOString(), history: [{ id: crypto.randomUUID(), type: "claimed", note: "Ownership taken. Call customer.", at: new Date().toISOString() }, ...entry.history] } : entry));
      setDetail(null); flash(`${item.fullName} is now in your Due list.`);
    } catch (error) { flash(error instanceof Error ? error.message : "Could not take ownership."); } finally { setBusy(false); }
  };
  const saveAction = async () => {
    if (!actionTarget || note.trim().length < 2) return flash("Add a short call summary first.");
    if (actionType === "follow_up" && new Date(nextActionAt) <= new Date()) return flash("Choose a future follow-up time.");
    setBusy(true);
    try {
      const payload = actionType === "follow_up" ? { type: actionType, note, nextActionAt: new Date(nextActionAt).toISOString() } : actionType === "not_proceeding" ? { type: actionType, note, lostReason } : { type: actionType, note };
      if (apiBase) { const response = await fetch(`${apiBase}/crm/opportunities/${actionTarget.id}/action`, { method: "POST", credentials: "include", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) }); const body = await response.json(); if (!response.ok) throw new Error(body.error?.message || "Could not save the action."); await load(actionType === "follow_up" ? "upcoming" : "closed"); }
      else setItems((current) => current.map((item) => item.id !== actionTarget.id ? item : { ...item, status: actionType === "sold" ? "won" : actionType === "not_proceeding" ? "lost" : "open", nextActionAt: actionType === "follow_up" ? new Date(nextActionAt).toISOString() : null, nextActionLabel: actionType === "follow_up" ? "Follow up" : null, lastActionAt: new Date().toISOString(), lastNote: note, closedAt: actionType === "follow_up" ? null : new Date().toISOString(), lostReason: actionType === "not_proceeding" ? lostReason : null, history: [{ id: crypto.randomUUID(), type: actionType, note, lostReason: actionType === "not_proceeding" ? lostReason : undefined, nextActionAt: actionType === "follow_up" ? new Date(nextActionAt).toISOString() : undefined, at: new Date().toISOString() }, ...item.history] }));
      setActionTarget(null); setView("work"); setFilter(actionType === "follow_up" ? "upcoming" : "closed"); flash(actionType === "follow_up" ? "Saved in Follow-ups." : "Outcome saved in Closed.");
    } catch (error) { flash(error instanceof Error ? error.message : "Could not save the action."); } finally { setBusy(false); }
  };
  const openDetail = async (item: CrmOpportunity) => {
    setDetailTab("form"); setDetail(item); if (!apiBase) return;
    try { const response = await fetch(`${apiBase}/crm/opportunities/${item.id}`, { credentials: "include" }); const body = await response.json(); if (response.ok && body.data) setDetail(body.data); } catch { /* the list still provides useful context */ }
  };
  return <div className="desk-shell minimal-desk">
    <aside className="desk-sidebar"><div className="sidebar-brand"><span><img src="/logo.svg" alt="Eyeagle" /></span><div><strong>Eyeagle</strong><small>Sales desk</small></div></div><div className="sidebar-heading"><span>Work</span><small>Keep the next promise visible.</small></div><nav><button className={view === "new" ? "active" : ""} onClick={() => setView("new")}><span><Inbox size={16} />New enquiries</span><b>{newCount}</b></button><button className={view === "work" ? "active" : ""} onClick={() => setView("work")}><span><ClipboardList size={16} />My work</span><b>{openCount}</b></button><button className={view === "all" ? "active" : ""} onClick={() => setView("all")}><span><Users size={16} />All sales</span></button></nav><div className="sidebar-footer"><div className="sidebar-source"><FileText size={16} /><div><strong>Jotform intake</strong><small>Manual refresh only</small></div></div></div></aside>
    <main className="desk-frame"><div className="desk-main"><section className="workspace">
        <div className="page-heading"><div><h1>{view === "new" ? "New enquiries" : view === "work" ? "My work" : "All sales"}</h1><p>{view === "new" ? "Unclaimed Jotform submissions" : view === "work" ? "Calls and follow-ups you own" : "Read-only view of who is handling what"}</p></div>{view === "new" && <Button variant="outline" size="sm" onClick={refresh} disabled={busy}><RefreshCw size={14} className={busy ? "spin" : ""} />Refresh Jotform</Button>}</div>
        <div className="queue-toolbar">{view !== "new" ? <div className="simple-filters">{(["due", "upcoming", "closed"] as WorkFilter[]).map((value) => <button key={value} className={filter === value ? "active" : ""} onClick={() => setFilter(value)}>{value === "due" ? "Due" : value === "upcoming" ? "Follow-ups" : "Closed"}</button>)}</div> : <span className="queue-scope">{newCount} waiting for ownership</span>}<label className="desk-search"><Search size={14} /><span className="sr-only">{view === "new" ? "Search enquiries" : view === "work" ? "Search my work" : "Search all sales"}</span><Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder={view === "new" ? "Search enquiries" : view === "work" ? "Search my work" : "Search all sales"} /></label></div>
        <div className="queue-list"><div className={`queue-head ${view === "new" ? "intake-grid" : "minimal-grid"}`}>{view === "new" ? <><span>Customer</span><span>Interested in</span><span>Considering for</span><span>Main concern</span><span>Preferred callback</span><span>Submitted</span><span></span></> : <><span>{view === "all" ? "Customer / owner" : "Customer"}</span><span>Sales next action</span><span>Last update</span><span>Status</span><span></span></>}</div>{rows.map((item) => <div className={`queue-row ${view === "new" ? "intake-grid" : "minimal-grid"}`} key={item.id}><button className="customer-cell" onClick={() => void openDetail(item)}><span className="customer-avatar">{item.fullName.split(" ").map((part) => part[0]).slice(0, 2).join("")}</span><span><strong>{item.fullName}</strong><small>{item.location || "Location not provided"} · {item.phone}</small>{view === "all" && <em className="owner-inline">Owner · {item.ownerName || "Unknown"}</em>}</span></button>{view === "new" ? <><button className="minimal-context" onClick={() => void openDetail(item)}><strong>{item.interest || formValue(item, ["what would you like next"])}</strong></button><button className="minimal-context" onClick={() => void openDetail(item)}><strong>{formValue(item, ["considering eyEagle".toLowerCase()])}</strong></button><button className="minimal-context" onClick={() => void openDetail(item)}><strong>{formValue(item, ["main safety concern"])}</strong></button><button className="minimal-context" onClick={() => void openDetail(item)}><strong>{formValue(item, ["preferred time to contact"])}</strong><small>{formValue(item, ["timings"])}</small></button><span className="minimal-meta">{formatAge(item.submittedAt)}</span><div className="row-action"><Button size="sm" onClick={() => void claim(item)} disabled={busy}>Take ownership</Button></div></> : <><button className="minimal-context" onClick={() => void openDetail(item)}><strong>{item.nextActionLabel || statusLabel(item)}</strong><small>{item.nextActionAt ? formatDate(item.nextActionAt) : item.lostReason || "Closed"}</small></button><span className="minimal-meta">{formatDate(item.lastActionAt || item.closedAt)}</span><span className={`minimal-status ${statusLabel(item).toLowerCase().replace(" ", "-")}`}>{statusLabel(item)}</span><div className="row-action">{view === "all" ? <Button variant="ghost" size="sm" onClick={() => void openDetail(item)}>View</Button> : item.status === "open" ? <Button size="sm" onClick={() => { setActionTarget(item); setActionType("follow_up"); setNote(""); setNextActionAt(localDateTime()); }}>Take action</Button> : <Button variant="ghost" size="sm" onClick={() => void openDetail(item)}>History</Button>}</div></>}</div>)}{rows.length === 0 && <div className="desk-empty"><CheckCircle2 size={27} /><strong>{view === "new" ? "No new enquiries" : "Nothing here right now"}</strong><span>{view === "new" ? "Refresh Jotform when you are ready." : "Scheduled follow-ups remain visible here until they become due."}</span></div>}</div>
      </section></div></main>
    <Dialog open={Boolean(actionTarget)} onOpenChange={(open) => !open && setActionTarget(null)}><DialogContent><DialogHeader><DialogTitle>Take action</DialogTitle><DialogDescription>Record what happened offline with {actionTarget?.fullName}.</DialogDescription></DialogHeader><div className="minimal-form"><label>Outcome<Select value={actionType} onChange={(event) => setActionType(event.target.value as ActionType)}><option value="follow_up">Follow up</option><option value="sold">Sold</option><option value="not_proceeding">Not proceeding</option></Select></label>{actionType === "follow_up" && <label>Next follow-up<Input className="date-time-input" type="datetime-local" value={nextActionAt} onClick={(event) => event.currentTarget.showPicker?.()} onChange={(event) => setNextActionAt(event.target.value)} /></label>}{actionType === "not_proceeding" && <label>Reason<Select value={lostReason} onChange={(event) => setLostReason(event.target.value)}><option>Not interested</option><option>Price</option><option>Chose another option</option><option>Invalid contact</option><option>Other</option></Select></label>}<label>Call summary<Textarea value={note} onChange={(event) => setNote(event.target.value)} placeholder="What did you discuss?" /></label></div><DialogFooter><Button variant="outline" onClick={() => setActionTarget(null)}>Cancel</Button><Button onClick={() => void saveAction()} disabled={busy}>{actionType === "follow_up" ? "Save follow-up" : "Save outcome"}</Button></DialogFooter></DialogContent></Dialog>
    <Dialog open={Boolean(detail)} onOpenChange={(open) => !open && setDetail(null)}><DialogContent className="detail-dialog"><DialogHeader><DialogTitle>{detail?.fullName}</DialogTitle><DialogDescription>{detail?.phone}{detail?.location ? ` · ${detail.location}` : ""}</DialogDescription>{detail && <div className="submission-meta"><span>Submitted · {formatDate(detail.submittedAt)}</span><span>Jotform</span></div>}</DialogHeader>{detail && <div className="detail-content">{detail.status === "new" ? <section className="ownership-section"><div><h3>Ownership</h3><strong>Unclaimed enquiry</strong><p>Take ownership when you are ready to make the first call.</p></div><Button onClick={() => void claim(detail)} disabled={busy}>Take ownership</Button></section> : <section><h3>Sales next action</h3><strong>{detail.nextActionLabel || statusLabel(detail)}</strong><p>{detail.nextActionAt ? formatDate(detail.nextActionAt) : detail.lastNote || "No further action."}</p></section>}<div className="detail-tabs" role="tablist" aria-label="Enquiry details"><button role="tab" aria-selected={detailTab === "form"} onClick={() => setDetailTab("form")}>Form submission</button><button role="tab" aria-selected={detailTab === "history"} onClick={() => setDetailTab("history")}>Activity history <span>{detail.history.length}</span></button></div>{detailTab === "form" ? <section className="detail-tab-panel" role="tabpanel"><p className="form-context-note">Read-only form responses, exactly as submitted.</p><div className="submission-group"><span>Contact details</span><div className="submission-fields">{submissionEntries(detail).filter(([label]) => contactLabels.has(label)).map(submissionField)}</div></div><div className="submission-group"><span>Form responses</span><div className="submission-fields">{submissionEntries(detail).filter(([label]) => !contactLabels.has(label)).map(submissionField)}</div></div></section> : <section className="detail-tab-panel" role="tabpanel">{detail.history.length ? detail.history.map((event) => <article className="history-line" key={event.id}><Clock3 size={14} /><div><strong>{event.type.replace("_", " ")}</strong><p>{event.note || event.lostReason || "Updated"}{event.nextActionAt ? ` · Next: ${formatDate(event.nextActionAt)}` : ""}</p><small>{formatDate(event.at)}</small></div></article>) : <p>No activity yet.</p>}</section>}</div>}</DialogContent></Dialog>
    {toast && <div className="toast">{toast}</div>}
  </div>;
}
