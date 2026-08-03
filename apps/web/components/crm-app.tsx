"use client";

import { useMemo, useState } from "react";
import { Check, SlidersHorizontal } from "lucide-react";
import { initialActivities, initialLeads, type Lead } from "@/lib/demo-data";
import { CRMLayout } from "./crm/app-shell";
import { LeadListScreen } from "./crm/screens/lead-list-screen";
import { PipelineScreen } from "./crm/screens/pipeline-screen";
import { SettingsScreen } from "./crm/screens/settings-screen";
import { TeamScreen } from "./crm/screens/team-screen";
import { TodayScreen } from "./crm/screens/today-screen";
import type { CRMView } from "./crm/types";
import { viewTitle } from "./crm/types";
import { LeadDrawer } from "./crm/workflows/lead-drawer";
import { ScheduleDialog } from "./crm/workflows/schedule-dialog";

export function CRMApp() {
  const [view, setView] = useState<CRMView>("today");
  const [leads, setLeads] = useState(initialLeads);
  const [activities, setActivities] = useState(initialActivities);
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null);
  const [scheduleLead, setScheduleLead] = useState<Lead | null>(null);
  const [query, setQuery] = useState("");
  const [mobileNavigationOpen, setMobileNavigationOpen] = useState(false);
  const [toast, setToast] = useState("");

  const unclaimedLeads = leads.filter((lead) => lead.status === "unclaimed");
  const ownedLeads = leads.filter((lead) => lead.ownerName === "Asha Mehta" && lead.status === "active");
  const leadsWithoutNextAction = ownedLeads.filter((lead) => !lead.nextActivityAt);
  const overdueCount = activities.filter((activity) => activity.status === "overdue").length;
  const filteredLeads = useMemo(() => leads.filter((lead) => [lead.customerName, lead.phone, lead.city, lead.summary, lead.stage].join(" ").toLowerCase().includes(query.toLowerCase())), [leads, query]);

  const flash = (message: string) => { setToast(message); window.setTimeout(() => setToast(""), 2600); };
  const claimLead = (lead: Lead) => {
    const claimed = { ...lead, status: "active", stage: "Picked Up", ownerName: "Asha Mehta" };
    setLeads((items) => items.map((item) => item.id === lead.id ? claimed : item));
    setSelectedLead(null); setScheduleLead(claimed); flash(`${lead.customerName} is now yours.`);
  };
  const completeActivity = (activityId: string) => {
    setActivities((items) => items.map((item) => item.id === activityId ? { ...item, status: "completed" } : item));
    flash("Activity completed. Choose what happens next.");
  };
  const scheduleActivity = (date: string, title: string) => {
    if (!scheduleLead) return;
    setActivities((items) => [...items, { id: `act-${Date.now()}`, leadId: scheduleLead.id, customerName: scheduleLead.customerName, phone: scheduleLead.phone, type: "Call", title, scheduledStart: date, status: "scheduled" }]);
    setLeads((items) => items.map((lead) => lead.id === scheduleLead.id ? { ...lead, nextActivityAt: date } : lead));
    setScheduleLead(null); flash("Follow-up scheduled with two reminders.");
  };

  const openLeadById = (id: string) => setSelectedLead(leads.find((lead) => lead.id === id) || null);
  return <CRMLayout view={view} query={query} mobileOpen={mobileNavigationOpen} unclaimedCount={unclaimedLeads.length} needsActionCount={leadsWithoutNextAction.length} onViewChange={setView} onQueryChange={setQuery} onMobileOpenChange={setMobileNavigationOpen}>
    <div className="workspace">
      <div className="page-heading"><div><span className="eyebrow">{viewTitle[view].eyebrow}</span><h1>{viewTitle[view].title}</h1><p>{viewTitle[view].description}</p></div>{["unclaimed", "mine", "customers"].includes(view) && <button className="secondary"><SlidersHorizontal size={16} />Filters</button>}</div>
      {view === "today" && <TodayScreen activities={activities} unclaimed={unclaimedLeads} noNext={leadsWithoutNextAction} onOpen={openLeadById} onComplete={completeActivity} onNavigate={setView} />}
      {view === "unclaimed" && <LeadListScreen leads={filteredLeads.filter((lead) => lead.status === "unclaimed")} mode="claim" onOpen={setSelectedLead} onClaim={claimLead} />}
      {view === "mine" && <LeadListScreen leads={filteredLeads.filter((lead) => lead.ownerName === "Asha Mehta" && lead.status === "active")} mode="mine" onOpen={setSelectedLead} onClaim={claimLead} />}
      {view === "customers" && <LeadListScreen leads={filteredLeads} mode="all" onOpen={setSelectedLead} onClaim={claimLead} />}
      {view === "pipeline" && <PipelineScreen leads={leads} onOpen={setSelectedLead} />}
      {view === "team" && <TeamScreen leads={leads} overdue={overdueCount} />}
      {view === "settings" && <SettingsScreen onSave={() => flash("Workspace settings saved.")} />}
    </div>
    {selectedLead && <LeadDrawer lead={selectedLead} activities={activities.filter((activity) => activity.leadId === selectedLead.id)} onClose={() => setSelectedLead(null)} onClaim={() => claimLead(selectedLead)} onSchedule={() => { setScheduleLead(selectedLead); setSelectedLead(null); }} />}
    {scheduleLead && <ScheduleDialog lead={scheduleLead} onClose={() => setScheduleLead(null)} onSave={scheduleActivity} />}
    {toast && <div className="toast"><Check size={17} />{toast}</div>}
  </CRMLayout>;
}
