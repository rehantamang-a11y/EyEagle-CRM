"use client";

import { useMemo, useState } from "react";
import { AlertTriangle, ArrowRight, Bell, CalendarCheck, Check, ChevronDown, ChevronRight, Clock3, FileInput, Inbox, LogOut, Menu, PackageSearch, PhoneCall, RefreshCw, Search, UserRound, X } from "lucide-react";
import { approvedPurchaseLinks, initialOpportunities, type Opportunity } from "@/lib/demo-data";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

type PrimaryView = "new" | "mine" | "team";
type NewFilter = "all" | "assessment" | "product" | "immediate";
type WorkFilter = "due" | "upcoming" | "no_action" | "snoozed" | "closed";
type ContactResult = "reached" | "no_answer" | "wrong_number";
type NextStep = "schedule_follow_up" | "confirm_audit" | "send_purchase_link" | "not_proceeding" | "do_not_contact" | "mark_sold" | "update_number";
type DeskNotification = { id: string; opportunity: Opportunity; title: string; body: string; kind: "overdue" | "due" | "assessment" | "purchase" | "follow_up" | "no_action"; at?: string; priority: number };
type ApiOpportunity = Partial<Opportunity> & { id: string; customerName?: string; phone?: string; status?: string; priority?: string; createdAt?: string };

const owner = "Asha Mehta";
const teamMembers = ["Asha Mehta", "Rohan Gupta", "Priya Shah"];
const formatDateTime = (value?: string) => value ? new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }).format(new Date(value)) : "No next action";
const formatShortDate = (value: string) => new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short" }).format(new Date(value));
const localValue = (date: Date) => { const pad = (value: number) => String(value).padStart(2, "0"); return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`; };
const initials = (name: string) => name.split(" ").filter((part) => /^[A-Za-z]/.test(part)).slice(0, 2).map((part) => part[0]).join("");
const isOpen = (item: Opportunity) => ["active", "snoozed"].includes(item.status);
const isClosed = (item: Opportunity) => ["won", "lost", "do_not_contact"].includes(item.status);
const personContext = (item: Opportunity) => (item.consideringFor?.[0] || "Home safety enquiry").replace("Senior parent / grandparent living in the same home", "Senior family member at home").replace("Senior parent / grandparent living away", "Senior family member living away");

function interestLabel(value?: string) {
  if (value === "Book a bathroom safety assessment") return "Interested in an assessment";
  if (value === "Understand the EyEagle safety kit") return "Interested in the safety kit";
  if (value === "Get pricing details") return "Interested in pricing";
  if (value === "Just share information for now") return "Looking for information";
  return value || "General home-safety enquiry";
}

function callbackPreference(item: Opportunity) {
  return [item.preferredContactDay, item.preferredContactPeriod].filter(Boolean).join(" · ") || "No preference provided";
}

function callbackPassed(item: Opportunity, now: Date) {
  if (!item.preferredContactDay) return false;
  const submitted = new Date(item.submittedAt || item.createdAt);
  const target = new Date(submitted);
  const offsets: Record<string, number> = { Today: 0, Tomorrow: 1, "Day After Tomorrow": 2 };
  if (item.preferredContactDay === "This weekend") {
    const days = (6 - target.getDay() + 7) % 7;
    target.setDate(target.getDate() + days);
  } else target.setDate(target.getDate() + (offsets[item.preferredContactDay] ?? 0));
  target.setHours(item.preferredContactPeriod === "Morning" ? 12 : item.preferredContactPeriod === "Afternoon" ? 17 : 22, 0, 0, 0);
  return now > target;
}

function contactStatus(item: Opportunity) {
  if (isClosed(item)) return <Badge variant={item.status === "won" ? "success" : item.status === "do_not_contact" ? "destructive" : "secondary"}>{item.status === "won" ? "Closed · sold" : "Closed"}</Badge>;
  if (item.stage === "Audit scheduled") return <Badge variant="success">Assessment scheduled</Badge>;
  if (item.stage === "Awaiting purchase") return <Badge variant="success">Product follow-up</Badge>;
  if (!item.lastInteractionAt) return <Badge variant="warning">Not contacted</Badge>;
  if (item.unsuccessfulAttempts) return <Badge variant="warning">Call attempted</Badge>;
  return <Badge variant="default">Spoke to customer</Badge>;
}

function opportunityFromApi(item: ApiOpportunity): Opportunity {
  const status: Opportunity["status"] = ["unclaimed", "active", "snoozed", "won", "lost", "do_not_contact"].includes(item.status || "") ? item.status as Opportunity["status"] : "active";
  const priority: Opportunity["priority"] = ["urgent", "high", "normal", "low"].includes(item.priority || "") ? item.priority as Opportunity["priority"] : "normal";
  const submittedAt = item.submittedAt || item.createdAt || new Date().toISOString();
  return {
    ...item,
    id: item.id,
    customerName: item.customerName || "Unnamed customer",
    phone: item.phone || "No phone number",
    city: item.city || "",
    source: item.source || "Jotform",
    summary: item.summary || "Jotform enquiry",
    stage: item.stage || "New enquiry",
    status,
    priority,
    createdAt: item.createdAt || submittedAt,
    submittedAt,
    timeline: item.timeline?.length ? item.timeline : [{ id: `${item.id}-import`, label: "Jotform enquiry imported", detail: item.summary || "Imported from Jotform.", at: submittedAt }],
  };
}

export function CRMApp() {
  const [items, setItems] = useState(initialOpportunities);
  const [view, setView] = useState<PrimaryView>("mine");
  const [newFilter, setNewFilter] = useState<NewFilter>("all");
  const [workFilter, setWorkFilter] = useState<WorkFilter>("due");
  const [ownerFilter, setOwnerFilter] = useState("all");
  const [query, setQuery] = useState("");
  const [active, setActive] = useState<Opportunity | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [transferTarget, setTransferTarget] = useState<Opportunity | null>(null);
  const [selectedOwner, setSelectedOwner] = useState(teamMembers[1]);
  const [contactResult, setContactResult] = useState<ContactResult>("reached");
  const [nextStep, setNextStep] = useState<NextStep>("schedule_follow_up");
  const [note, setNote] = useState("");
  const [nextAt, setNextAt] = useState("");
  const [address, setAddress] = useState("");
  const [auditContext, setAuditContext] = useState("");
  const [duration, setDuration] = useState("60");
  const [reason, setReason] = useState("not_interested");
  const [updatedPhone, setUpdatedPhone] = useState("");
  const [purchaseLinkId, setPurchaseLinkId] = useState(approvedPurchaseLinks[0].id);
  const [customerConfirmed, setCustomerConfirmed] = useState(false);
  const [confirmDnc, setConfirmDnc] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [toast, setToast] = useState("");
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [readNotifications, setReadNotifications] = useState<string[]>([]);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const [signedOut, setSignedOut] = useState(false);

  const now = new Date();
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(now);
  const counts = {
    new: items.filter((item) => item.status === "unclaimed").length,
    mine: items.filter((item) => item.ownerName === owner && isOpen(item)).length,
    due: items.filter((item) => item.ownerName === owner && isOpen(item) && item.nextActionAt && (new Date(item.nextActionAt) < now || new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date(item.nextActionAt)) === today)).length,
    upcoming: items.filter((item) => item.ownerName === owner && isOpen(item) && item.nextActionAt && new Date(item.nextActionAt) > now && new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date(item.nextActionAt)) !== today).length,
    team: items.filter((item) => isOpen(item)).length,
  };

  const notifications = useMemo<DeskNotification[]>(() => items.filter((item) => item.ownerName === owner && isOpen(item)).map((item): DeskNotification => {
    const id = `${item.id}:${item.nextActionAt || "no-action"}:${item.nextActionTitle || "contact"}`;
    if (!item.nextActionAt) return { id, opportunity: item, title: "Customer needs an action", body: `${item.customerName} has no next action scheduled.`, kind: "no_action", priority: 0 };
    const actionAt = new Date(item.nextActionAt);
    const actionDay = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(actionAt);
    if (actionAt < now) return { id, opportunity: item, title: `${item.nextActionTitle || "Follow-up"} overdue`, body: `${item.customerName} · due ${formatDateTime(item.nextActionAt)}`, kind: "overdue", at: item.nextActionAt, priority: 0 };
    if (actionDay === today) return { id, opportunity: item, title: `${item.nextActionTitle || "Action"} due today`, body: `${item.customerName} · ${formatDateTime(item.nextActionAt)}`, kind: "due", at: item.nextActionAt, priority: 1 };
    if (item.stage === "Audit scheduled") return { id, opportunity: item, title: "Bathroom assessment scheduled", body: `${item.customerName} · ${formatDateTime(item.nextActionAt)}`, kind: "assessment", at: item.nextActionAt, priority: 2 };
    if (item.stage === "Awaiting purchase") return { id, opportunity: item, title: "Product follow-up coming up", body: `${item.customerName} · ${formatDateTime(item.nextActionAt)}`, kind: "purchase", at: item.nextActionAt, priority: 3 };
    return { id, opportunity: item, title: item.nextActionTitle || "Follow-up scheduled", body: `${item.customerName} · ${formatDateTime(item.nextActionAt)}`, kind: "follow_up", at: item.nextActionAt, priority: 4 };
  }).sort((a, b) => a.priority - b.priority || new Date(a.at || 0).getTime() - new Date(b.at || 0).getTime()), [items, now, today]);
  const unreadCount = notifications.filter((item) => !readNotifications.includes(item.id)).length;

  const visible = useMemo(() => items.filter((item) => {
    const searchMatch = [item.customerName, item.phone, item.city, item.summary, item.expressedInterest].join(" ").toLowerCase().includes(query.toLowerCase());
    if (!searchMatch) return false;
    if (view === "new") {
      if (item.status !== "unclaimed") return false;
      if (newFilter === "assessment" && item.expressedInterest !== "Book a bathroom safety assessment") return false;
      if (newFilter === "product" && !["Understand the EyEagle safety kit", "Get pricing details", "Just share information for now"].includes(item.expressedInterest || "")) return false;
      if (newFilter === "immediate" && !item.immediateSafetyConcern) return false;
      return true;
    }
    const owned = view === "mine" ? item.ownerName === owner : ownerFilter === "all" ? true : ownerFilter === "unclaimed" ? !item.ownerName : item.ownerName === ownerFilter;
    if (!owned) return false;
    if (workFilter === "closed") return isClosed(item);
    if (!isOpen(item)) return false;
    if (workFilter === "snoozed") return item.status === "snoozed";
    if (workFilter === "no_action") return !item.nextActionAt;
    if (workFilter === "upcoming") return Boolean(item.nextActionAt && new Date(item.nextActionAt) > now && new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date(item.nextActionAt)) !== today);
    return Boolean(item.nextActionAt && (new Date(item.nextActionAt) < now || new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date(item.nextActionAt)) === today));
  }).sort((a, b) => {
    if (view === "new") return Number(Boolean(b.immediateSafetyConcern)) - Number(Boolean(a.immediateSafetyConcern)) || new Date(a.submittedAt || a.createdAt).getTime() - new Date(b.submittedAt || b.createdAt).getTime();
    const aTime = a.nextActionAt ? new Date(a.nextActionAt).getTime() : 0;
    const bTime = b.nextActionAt ? new Date(b.nextActionAt).getTime() : 0;
    return aTime - bTime;
  }), [items, view, newFilter, workFilter, ownerFilter, query, now, today]);

  const detail = items.find((item) => item.id === detailId) || null;
  const notify = (message: string) => { setToast(message); window.setTimeout(() => setToast(""), 2600); };
  const defaultTomorrow = () => { const date = new Date(); date.setDate(date.getDate() + 1); date.setHours(11, 0, 0, 0); return localValue(date); };
  const resetInteraction = () => { setActive(null); setContactResult("reached"); setNextStep("schedule_follow_up"); setNote(""); setNextAt(""); setAddress(""); setAuditContext(""); setReason("not_interested"); setUpdatedPhone(""); setCustomerConfirmed(false); setConfirmDnc(false); };
  const openInteraction = (item: Opportunity) => { setActive(item); setUpdatedPhone(item.phone); setNextAt(defaultTomorrow()); };
  const refresh = async () => {
    const apiBase = process.env.NEXT_PUBLIC_CRM_API_URL;
    if (!apiBase) { notify("Jotform sync needs the CRM API to be running"); return; }
    setRefreshing(true);
    try {
      const response = await fetch(`${apiBase}/integrations/jotform/sync`, { method: "POST", headers: { "content-type": "application/json" }, credentials: "include", body: JSON.stringify({ includeExisting: true }) });
      const result = await response.json() as { data?: { scanned: number; imported: number; repeated: number; issues: number }; error?: { message?: string } };
      if (!response.ok) throw new Error(result.error?.message || "Jotform could not be refreshed.");
      const opportunitiesResponse = await fetch(`${apiBase}/opportunities?view=all`, { credentials: "include" });
      const opportunities = await opportunitiesResponse.json() as { data?: ApiOpportunity[]; error?: { message?: string } };
      if (!opportunitiesResponse.ok) throw new Error(opportunities.error?.message || "Jotform was refreshed, but the CRM list could not be loaded.");
      if (opportunities.data) setItems(opportunities.data.map(opportunityFromApi));
      notify(`Jotform refreshed · ${result.data?.imported || 0} imported from ${result.data?.scanned || 0} submissions`);
    } catch (error) {
      notify(error instanceof TypeError ? "Jotform sync needs the CRM API and database running" : error instanceof Error ? error.message : "Jotform could not be refreshed.");
    } finally { setRefreshing(false); }
  };
  const openNotification = (notification: DeskNotification) => {
    setReadNotifications((current) => current.includes(notification.id) ? current : [...current, notification.id]);
    setNotificationsOpen(false);
    setView("mine");
    setWorkFilter(notification.kind === "no_action" ? "no_action" : notification.kind === "overdue" || notification.kind === "due" ? "due" : "upcoming");
    setDetailId(notification.opportunity.id);
  };
  const logOut = async () => {
    setAccountOpen(false);
    const apiBase = process.env.NEXT_PUBLIC_CRM_API_URL;
    if (apiBase) {
      try { await fetch(`${apiBase}/auth/logout`, { method: "POST", credentials: "include" }); }
      catch { /* Local pilot can still end its in-memory session when the API is offline. */ }
    }
    setSignedOut(true);
  };

  const saveClaim = (target: Opportunity) => {
    const claimed = { ...target, ownerName: owner, status: "active" as const, stage: "Contacting", warning: "Not contacted", nextActionAt: undefined, nextActionTitle: "Contact customer" };
    setItems((current) => current.map((item) => item.id === target.id ? claimed : item));
    setView("mine"); setWorkFilter("no_action");
    notify("Ownership taken");
  };

  const availableSteps: Array<{ id: NextStep; label: string }> = contactResult === "reached" ? [
    { id: "schedule_follow_up", label: "Follow up later" }, { id: "confirm_audit", label: "Schedule bathroom assessment" }, { id: "send_purchase_link", label: "Share product or pricing" }, { id: "mark_sold", label: "Customer wants to buy" }, { id: "not_proceeding", label: "Not interested · close" }, { id: "do_not_contact", label: "Do not contact" },
  ] : contactResult === "no_answer" ? [
    { id: "schedule_follow_up", label: "Try again later" }, { id: "not_proceeding", label: "Close as unreachable" },
  ] : [
    { id: "update_number", label: "Update number and retry" }, { id: "not_proceeding", label: "Close as invalid contact" },
  ];

  const changeContactResult = (result: ContactResult) => {
    setContactResult(result);
    setNextStep(result === "wrong_number" ? "update_number" : result === "no_answer" ? "schedule_follow_up" : "schedule_follow_up");
    if (result === "wrong_number") setReason("invalid_contact");
    if (result === "no_answer") setReason("unreachable");
  };

  const requiresDate = ["schedule_follow_up", "confirm_audit", "send_purchase_link", "update_number"].includes(nextStep);
  const canSave = Boolean(active && note.trim() && (!requiresDate || nextAt) && (nextStep !== "confirm_audit" || address.trim() && customerConfirmed) && (nextStep !== "update_number" || updatedPhone.trim()) && (nextStep !== "do_not_contact" || confirmDnc));

  const saveInteraction = () => {
    if (!active || !canSave) return;
    const targetId = active.id;
    const nextIso = nextAt ? new Date(nextAt).toISOString() : undefined;
    const link = approvedPurchaseLinks.find((item) => item.id === purchaseLinkId);
    const label = availableSteps.find((item) => item.id === nextStep)?.label || "Interaction logged";
    const event = { id: `timeline-${Date.now()}`, at: new Date().toISOString(), label, detail: `Phone call · ${contactResult.replaceAll("_", " ")} — ${note}` };
    setItems((current) => current.map((item) => {
      if (item.id !== active.id) return item;
      const base = { ...item, lastInteractionAt: event.at, timeline: [event, ...item.timeline], warning: undefined, unsuccessfulAttempts: contactResult === "no_answer" ? (item.unsuccessfulAttempts || 0) + 1 : 0 };
      if (nextStep === "schedule_follow_up") return { ...base, status: "active" as const, stage: "Contacting", nextActionAt: nextIso, nextActionTitle: contactResult === "no_answer" ? "Retry call" : "Customer follow-up" };
      if (nextStep === "confirm_audit") return { ...base, status: "active" as const, stage: "Audit scheduled", nextActionAt: nextIso, nextActionTitle: "Bathroom audit", auditAt: nextIso, auditConfirmedAt: event.at, calendarSyncStatus: "pending" as const };
      if (nextStep === "send_purchase_link") return { ...base, status: "active" as const, stage: "Awaiting purchase", nextActionAt: nextIso, nextActionTitle: "Purchase review", purchaseLinkName: link?.name };
      if (nextStep === "not_proceeding") return { ...base, status: "lost" as const, stage: "Not proceeding", nextActionAt: undefined, nextActionTitle: undefined, closeReason: reason };
      if (nextStep === "do_not_contact") return { ...base, status: "do_not_contact" as const, stage: "Do not contact", nextActionAt: undefined, nextActionTitle: undefined, closeReason: reason };
      if (nextStep === "update_number") return { ...base, phone: updatedPhone, status: "active" as const, stage: "Contacting", nextActionAt: nextIso, nextActionTitle: "Retry updated number" };
      return { ...base, status: "won" as const, stage: "Converted", nextActionAt: undefined, nextActionTitle: undefined, handoffStatus: "awaiting_shopify_link" as const, warning: "Awaiting Shopify link" };
    }));
    notify(nextStep === "confirm_audit" ? "Audit confirmed; Calendar sync queued" : nextStep === "mark_sold" ? "Sold recorded; order handoff created" : `${label} saved`);
    if (["schedule_follow_up", "send_purchase_link", "update_number"].includes(nextStep) && nextIso && new Date(nextIso) > now) setWorkFilter("upcoming");
    resetInteraction();
    setDetailId(targetId);
  };

  const transfer = () => {
    if (!transferTarget) return;
    const event = { id: `transfer-${Date.now()}`, at: new Date().toISOString(), label: "Ownership transferred", detail: `${owner} transferred this opportunity to ${selectedOwner}.` };
    setItems((current) => current.map((item) => item.id === transferTarget.id ? { ...item, ownerName: selectedOwner, timeline: [event, ...item.timeline] } : item));
    setTransferTarget(null); notify(`Assigned to ${selectedOwner}`);
  };

  const newFilters: Array<{ id: NewFilter; label: string }> = [
    { id: "all", label: "All" }, { id: "assessment", label: "Bathroom assessment" }, { id: "product", label: "Product information" }, { id: "immediate", label: "Marked immediate" },
  ];
  const workFilters: Array<{ id: WorkFilter; label: string }> = [
    { id: "due", label: `Due ${view === "mine" ? counts.due : ""}`.trim() }, { id: "upcoming", label: `Upcoming ${view === "mine" ? counts.upcoming : ""}`.trim() }, { id: "no_action", label: "No next action" }, { id: "snoozed", label: "Snoozed" }, { id: "closed", label: "Closed" },
  ];

  if (signedOut) return <main className="signed-out-screen"><div className="signed-out-mark"><img src="/logo.svg" alt="Eyeagle" /></div><strong>You’re logged out</strong><p>Your sales desk session has ended.</p><Button onClick={() => setSignedOut(false)}>Sign in again</Button></main>;

  return <div className="desk-shell">
    {mobileNavOpen && <button className="sidebar-scrim" aria-label="Close navigation" onClick={() => setMobileNavOpen(false)} />}
    <aside className={`desk-sidebar ${mobileNavOpen ? "mobile-open" : ""}`} aria-label="Sales navigation">
      <div className="sidebar-brand"><span><img src="/logo.svg" alt="Eyeagle" /></span><div><strong>Eyeagle</strong><small>Internal portal</small></div><button aria-label="Close navigation" onClick={() => setMobileNavOpen(false)}><X size={17} /></button></div>
      <div className="sidebar-heading"><span>Sales CRM</span><small>Enquiries and follow-ups</small></div>
      <nav>
        <button className={view === "new" ? "active" : ""} onClick={() => { setView("new"); setMobileNavOpen(false); }}><span><Inbox size={16} />New enquiries</span><b>{counts.new}</b></button>
        <button className={view === "mine" ? "active" : ""} onClick={() => { setView("mine"); setMobileNavOpen(false); }}><span><UserRound size={16} />My work</span><b>{counts.mine}</b></button>
        <button className={view === "team" ? "active" : ""} onClick={() => { setView("team"); setMobileNavOpen(false); }}><span><UserRound size={16} />Team</span><b>{counts.team}</b></button>
      </nav>
      <div className="sidebar-footer">
        <div className="sidebar-source"><FileInput size={15} /><span><strong>Jotform intake</strong><small>Manual refresh</small></span></div>
        <div className="sidebar-member"><span>AM</span><div><strong>{owner}</strong><small>Sales member</small></div></div>
      </div>
    </aside>

    <div className="desk-frame">
    <header className="desk-header">
      <div className="desk-breadcrumb"><button aria-label="Open navigation" onClick={() => setMobileNavOpen(true)}><Menu size={17} /></button><span>Sales CRM</span><ChevronRight size={14} /><strong>{view === "new" ? "New enquiries" : view === "mine" ? "My work" : "Team queue"}</strong></div>
      <div className="header-actions">
        <div className="notification-center">
          <button className="notification-trigger" aria-label={`Notifications${unreadCount ? `, ${unreadCount} unread` : ""}`} aria-expanded={notificationsOpen} onClick={() => setNotificationsOpen((open) => !open)}><Bell size={18} />{unreadCount > 0 && <span>{unreadCount > 9 ? "9+" : unreadCount}</span>}</button>
          {notificationsOpen && <div className="notification-panel" role="dialog" aria-label="Notifications">
            <div className="notification-header"><div><strong>Notifications</strong><small>{unreadCount ? `${unreadCount} unread` : "You are all caught up"}</small></div><div>{unreadCount > 0 && <button onClick={() => setReadNotifications(notifications.map((item) => item.id))}>Mark all read</button>}<button className="notification-close" aria-label="Close notifications" onClick={() => setNotificationsOpen(false)}><X size={16} /></button></div></div>
            <div className="notification-list">{notifications.map((notification) => {
              const unread = !readNotifications.includes(notification.id);
              const Icon = notification.kind === "assessment" ? CalendarCheck : notification.kind === "purchase" ? PackageSearch : notification.kind === "follow_up" || notification.kind === "due" || notification.kind === "overdue" ? PhoneCall : Clock3;
              return <button key={notification.id} className={`${unread ? "unread" : ""} ${notification.kind === "overdue" ? "urgent" : ""}`} onClick={() => openNotification(notification)}><span className="notification-icon"><Icon size={16} /></span><span><strong>{notification.title}</strong><small>{notification.body}</small></span>{unread && <i aria-label="Unread" />}</button>;
            })}{!notifications.length && <div className="notification-empty"><Check size={18} /><strong>No reminders</strong><small>New reminders will appear when an action is scheduled.</small></div>}</div>
          </div>}
        </div>
        <div className="account-menu">
          {accountOpen && <button className="account-menu-scrim" aria-label="Close account menu" onClick={() => setAccountOpen(false)} />}
          <button className="member-menu" aria-haspopup="menu" aria-expanded={accountOpen} onClick={() => { setAccountOpen((open) => !open); setNotificationsOpen(false); }}><span>AM</span><div><strong>{owner}</strong><small>Sales member</small></div><ChevronDown size={15} /></button>
          {accountOpen && <div className="account-panel" role="menu">
            <div className="account-links">
              <button role="menuitem" className="logout-action" onClick={logOut}><span><LogOut size={15} />Log out</span></button>
            </div>
          </div>}
        </div>
      </div>
    </header>

      <main className="desk-main">
        <section className="workspace">
        <div className="queue-intro">
          <div><h1>{view === "new" ? "New enquiries" : view === "mine" ? "My work" : "Team queue"}</h1><p>{view === "new" ? "Review the form and take ownership when you are ready." : "See the latest contact status and take the next action."}</p></div>
          <div className="queue-controls"><label className="desk-search"><span className="sr-only">Search opportunities</span><Search size={15} /><Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search name or phone" /></label><div className="sync-action"><span><FileInput size={13} />Checked just now</span><Button variant="outline" onClick={refresh} disabled={refreshing}><RefreshCw size={14} className={refreshing ? "spin" : ""} />{refreshing ? "Checking…" : "Refresh Jotform"}</Button></div></div>
        </div>

        <div className="filter-row">
          {(view === "new" ? newFilters : workFilters).map((filter) => <button key={filter.id} className={(view === "new" ? newFilter : workFilter) === filter.id ? "active" : ""} onClick={() => view === "new" ? setNewFilter(filter.id as NewFilter) : setWorkFilter(filter.id as WorkFilter)}>{filter.label}</button>)}
          {view === "team" && <label className="owner-filter"><span>Owner</span><Select value={ownerFilter} onChange={(event) => setOwnerFilter(event.target.value)}><option value="all">All owners</option><option value="unclaimed">Unclaimed</option>{teamMembers.map((member) => <option key={member}>{member}</option>)}</Select></label>}
        </div>

        <div className="queue-list">
          {view === "new" ? <>
            <div className="queue-head intake-grid"><span>Customer</span><span>Form context</span><span>Preferred callback</span><span>Received</span><span>Priority</span><span /></div>
            {visible.map((item) => <article className="queue-row intake-grid" key={item.id}>
              <button className="customer-cell" onClick={() => setDetailId(item.id)}><span className="customer-avatar">{initials(item.customerName)}</span><span><strong>{item.customerName}</strong><small>{item.phone} · {item.city}</small></span></button>
              <div className="context-cell"><strong>{interestLabel(item.expressedInterest)}</strong><small>{item.safetyConcerns?.[0] || item.summary}</small></div>
              <div className="callback-cell"><strong>{callbackPreference(item)}</strong><small>Submitted {formatShortDate(item.submittedAt || item.createdAt)}</small>{callbackPassed(item, now) && <em>Callback preference has passed</em>}</div>
              <div className="received-cell"><strong>{formatShortDate(item.submittedAt || item.createdAt)}</strong><small>{item.source}</small></div>
              <div className="priority-cell">{item.immediateSafetyConcern ? <><Badge variant="destructive">Marked immediate</Badge><small>Prioritize callback · not emergency support</small></> : <span>Standard</span>}</div>
              <div className="row-action"><Button size="sm" onClick={() => saveClaim(item)}>Take ownership</Button></div>
            </article>)}
          </> : <>
            <div className={`queue-head work-grid ${view === "team" ? "with-owner" : ""}`}><span>Customer</span><span>Next step</span><span>Contact status</span><span>Last update</span>{view === "team" && <span>Owner</span>}<span /></div>
            {visible.map((item) => <article className={`queue-row work-grid ${view === "team" ? "with-owner" : ""}`} key={item.id}>
              <button className="customer-cell" onClick={() => setDetailId(item.id)}><span className="customer-avatar">{initials(item.customerName)}</span><span><strong>{item.customerName}</strong><small>{interestLabel(item.expressedInterest)}</small><em>{item.phone} · {item.city}</em></span></button>
              <div className={`commitment-cell ${item.nextActionAt && new Date(item.nextActionAt) < now ? "overdue" : ""}`}><strong>{item.nextActionTitle || (isClosed(item) ? "Completed" : "No next action")}</strong><small>{formatDateTime(item.nextActionAt)}</small>{item.nextActionAt && new Date(item.nextActionAt) < now && <em>Overdue</em>}</div>
              <div className="state-cell">{contactStatus(item)}<small>{item.stage}</small>{item.auditAt && <small><CalendarCheck size={12} />Confirmed with customer</small>}</div>
              <div className="last-contact"><strong>{item.lastInteractionAt ? formatDateTime(item.lastInteractionAt) : "Not contacted"}</strong><small>{item.unsuccessfulAttempts ? `${item.unsuccessfulAttempts} unsuccessful attempt${item.unsuccessfulAttempts === 1 ? "" : "s"}` : ""}</small></div>
              {view === "team" && <div className="owner-cell"><strong>{item.ownerName || "Unclaimed"}</strong></div>}
              <div className="row-action"><button className="history-button" aria-label={`View history for ${item.customerName}`} onClick={() => setDetailId(item.id)}><Clock3 size={15} /></button>{isOpen(item) && <Button size="sm" variant="outline" onClick={() => view === "team" ? setTransferTarget(item) : openInteraction(item)}>{view === "team" ? "Reassign" : "Take action"}<ArrowRight size={13} /></Button>}</div>
            </article>)}
          </>}
          {!visible.length && <div className="desk-empty"><Check size={20} /><strong>Nothing here right now</strong><span>Try another queue or filter.</span></div>}
        </div>
        </section>
      </main>
    </div>

    <Dialog open={Boolean(active)} onOpenChange={(open) => !open && resetInteraction()}><DialogContent className="interaction-dialog">
      <DialogHeader><DialogTitle>Take action</DialogTitle><DialogDescription>Record what happened after contacting {active?.customerName}.</DialogDescription></DialogHeader>
      {active && <section className="action-history"><div><strong>Recent history</strong><small>Previous notes and actions</small></div><div>{active.timeline.slice(0, 3).map((event) => <article key={event.id}><span /><div><strong>{event.label}</strong><p>{event.detail}</p><small>{formatDateTime(event.at)}</small></div></article>)}</div></section>}
      <div className="form-stack">
        <label><span>Call status</span><Select value={contactResult} onChange={(event) => changeContactResult(event.target.value as ContactResult)}><option value="reached">Spoke to customer</option><option value="no_answer">No answer</option><option value="wrong_number">Wrong number</option></Select></label>
        <label><span>Comment</span><Textarea value={note} onChange={(event) => setNote(event.target.value)} placeholder="Add the important details from the call" /></label>
        <label><span>What happens next?</span><Select value={nextStep} onChange={(event) => setNextStep(event.target.value as NextStep)}>{availableSteps.map((step) => <option key={step.id} value={step.id}>{step.label}</option>)}</Select></label>
        {requiresDate && <label><span>{nextStep === "confirm_audit" ? "Assessment date and time" : nextStep === "send_purchase_link" ? "Product follow-up date" : nextStep === "update_number" ? "Retry date and time" : "Follow-up date and time"}</span><Input type="datetime-local" value={nextAt} onChange={(event) => setNextAt(event.target.value)} /></label>}
        {nextStep === "update_number" && <label><span>Updated phone number</span><Input value={updatedPhone} onChange={(event) => setUpdatedPhone(event.target.value)} /></label>}
        {nextStep === "confirm_audit" && <div className="audit-fields"><div className="form-grid"><label><span>Duration</span><Select value={duration} onChange={(event) => setDuration(event.target.value)}><option value="30">30 minutes</option><option value="60">60 minutes</option><option value="90">90 minutes</option><option value="120">2 hours</option></Select></label><label><span>Address</span><Input value={address} onChange={(event) => setAddress(event.target.value)} placeholder="Address for operations" /></label></div><label><span>Operations context</span><Textarea value={auditContext} onChange={(event) => setAuditContext(event.target.value)} placeholder="Access notes, family contact, relevant bathroom context" /></label><label className="confirmation"><input type="checkbox" checked={customerConfirmed} onChange={(event) => setCustomerConfirmed(event.target.checked)} /><span><strong>Customer confirmed this date and time</strong><small>Only confirmed appointments are added to the operations calendar.</small></span></label><div className="form-note"><CalendarCheck size={15} /><span>After saving, the CRM creates the appointment, queues Calendar sync, and schedules the next-working-day sales follow-up.</span></div></div>}
        {nextStep === "send_purchase_link" && <label><span>Approved purchase link</span><Select value={purchaseLinkId} onChange={(event) => setPurchaseLinkId(event.target.value)}>{approvedPurchaseLinks.map((link) => <option key={link.id} value={link.id}>{link.name}</option>)}</Select></label>}
        {["not_proceeding", "do_not_contact"].includes(nextStep) && <label><span>Close reason</span><Select value={reason} onChange={(event) => setReason(event.target.value)}><option value="not_interested">Not interested</option><option value="price">Price</option><option value="chose_alternative">Chose another option</option><option value="unreachable">Unreachable</option><option value="invalid_contact">Invalid contact</option><option value="outside_service_area">Outside service area</option><option value="other">Other</option></Select></label>}
        {nextStep === "do_not_contact" && <label className="confirmation danger-confirm"><input type="checkbox" checked={confirmDnc} onChange={(event) => setConfirmDnc(event.target.checked)} /><span><strong>Block all future outreach</strong><small>This applies to this customer across every opportunity.</small></span></label>}
      </div>
      <DialogFooter><Button variant="outline" onClick={resetInteraction}>Cancel</Button><Button disabled={!canSave} variant={nextStep === "do_not_contact" ? "destructive" : "default"} onClick={saveInteraction}>Save</Button></DialogFooter>
    </DialogContent></Dialog>

    <Dialog open={Boolean(transferTarget)} onOpenChange={(open) => !open && setTransferTarget(null)}><DialogContent>
      <DialogHeader><DialogTitle>Reassign opportunity</DialogTitle><DialogDescription>Future activities move to the new owner. Ownership history is preserved.</DialogDescription></DialogHeader>
      <div className="form-stack"><label><span>New owner</span><Select value={selectedOwner} onChange={(event) => setSelectedOwner(event.target.value)}>{teamMembers.filter((member) => member !== transferTarget?.ownerName).map((member) => <option key={member}>{member}</option>)}</Select></label></div>
      <DialogFooter><Button variant="outline" onClick={() => setTransferTarget(null)}>Cancel</Button><Button onClick={transfer}>Reassign</Button></DialogFooter>
    </DialogContent></Dialog>

    <Dialog open={Boolean(detail)} onOpenChange={(open) => !open && setDetailId(null)}><DialogContent className="detail-sheet">
      {detail && <><DialogHeader><div className="sheet-person"><span className="customer-avatar large">{initials(detail.customerName)}</span><div><DialogTitle>{detail.customerName}</DialogTitle><DialogDescription>{detail.phone} · {detail.city}</DialogDescription></div></div></DialogHeader>
        <div className="sheet-body">
          <section className="sales-commitment"><small>Next step</small><strong>{detail.nextActionTitle || (isClosed(detail) ? "Opportunity completed" : "No next action")}</strong><span>{formatDateTime(detail.nextActionAt)} · {detail.stage}</span>{isOpen(detail) && <Button size="sm" onClick={() => { setDetailId(null); openInteraction(detail); }}>Take action<ArrowRight size={13} /></Button>}</section>
          <section className="history-section"><div className="section-heading"><small>Call &amp; action history</small><span>{detail.timeline.length} recorded {detail.timeline.length === 1 ? "entry" : "entries"}</span></div><div className="timeline">{detail.timeline.map((event) => <div key={event.id}><span /><div><strong>{event.label}</strong><p>{event.detail}</p><small>{formatDateTime(event.at)}</small></div></div>)}</div></section>
          {detail.auditAt && <section className="confirmed-appointment"><div><CalendarCheck size={17} /><span><small>Confirmed appointment</small><strong>Bathroom audit · {formatDateTime(detail.auditAt)}</strong></span></div><div className="sync-states"><span><Check size={12} />Confirmed with customer</span><span className={detail.calendarSyncStatus === "failed" ? "failed" : ""}>Calendar {detail.calendarSyncStatus}</span></div></section>}
          <section className="form-context"><div className="section-heading"><small>Full submission</small><span>Every imported answer · read-only</span></div><dl>
            <div><dt>Name</dt><dd>{detail.customerName}</dd></div><div><dt>Phone / WhatsApp</dt><dd>{detail.phone}</dd></div>
            <div><dt>Site / location</dt><dd>{detail.city || "Not provided"}</dd></div><div><dt>Immediate safety concern</dt><dd className={detail.immediateSafetyConcern ? "answer-alert" : ""}>{detail.immediateSafetyConcern ? "Yes — marked immediate" : "No"}</dd></div>
            <div className="wide"><dt>Brief description</dt><dd>{detail.summary || "Not provided"}</dd></div>
            <div><dt>Who they are considering for</dt><dd>{detail.consideringFor?.join(", ") || "Not provided"}</dd></div><div><dt>Main safety concern</dt><dd>{detail.safetyConcerns?.join(", ") || "Not provided"}</dd></div>
            <div className="wide"><dt>What they would like next</dt><dd>{detail.expressedInterest || "Not provided"}</dd></div>
            <div><dt>Preferred callback day</dt><dd>{detail.preferredContactDay || "Not provided"}</dd></div><div><dt>Preferred callback time</dt><dd>{detail.preferredContactPeriod || "Not provided"}</dd></div>
            <div><dt>Source</dt><dd>{detail.source}</dd></div><div><dt>Submitted</dt><dd>{formatDateTime(detail.submittedAt || detail.createdAt)}</dd></div>
          </dl></section>
        </div></>}
    </DialogContent></Dialog>

    {toast && <div className="desk-toast"><Check size={15} />{toast}</div>}
  </div>;
}
