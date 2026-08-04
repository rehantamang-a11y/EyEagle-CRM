import { CalendarClock, Check, ChevronRight, CircleAlert, Phone } from "lucide-react";
import type { Activity, Lead } from "@/lib/demo-data";
import type { CRMView } from "../types";
import { minutesUntil, Priority, time } from "../shared/lead-format";

export function TodayScreen({ activities, unclaimed, noNext, onOpen, onComplete, onNavigate }: {
  activities: Activity[];
  unclaimed: Lead[];
  noNext: Lead[];
  onOpen: (leadId: string) => void;
  onComplete: (activityId: string) => void;
  onNavigate: (view: CRMView) => void;
}) {
  const todayKey = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());
  const active = activities.filter((activity) => activity.status !== "completed" && (activity.status === "overdue" || new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date(activity.scheduledStart)) === todayKey)).sort((a, b) => a.scheduledStart.localeCompare(b.scheduledStart));
  const next = activities.filter((activity) => activity.status === "scheduled" && new Date(activity.scheduledStart) > new Date()).sort((a, b) => a.scheduledStart.localeCompare(b.scheduledStart))[0];

  return <div className="today-layout"><section className="today-main">
    {next && <div className="next-action"><div><span className="eyebrow light">Next activity</span><h2>{next.title}</h2><p>{next.customerName} · {next.phone}</p></div><div className="next-time"><strong>{time(next.scheduledStart)}</strong><span suppressHydrationWarning>{minutesUntil(next.scheduledStart)} min</span></div><div className="next-buttons"><button className="inverted" onClick={() => onOpen(next.leadId)}>Open customer</button><button className="ghost-light" onClick={() => onComplete(next.id)}><Check size={16} />Complete</button></div></div>}
    <div className="section-title"><div><h2>Today’s activities</h2><p>{active.length} items · {activities.filter((activity) => activity.status === "completed").length} completed</p></div><button>View schedule <ChevronRight size={15} /></button></div>
    <div className="activity-list">{active.map((activity) => <div className={`activity-row ${activity.status}`} key={activity.id}><time>{time(activity.scheduledStart)}</time><div className="activity-line"><span className="activity-icon">{activity.type === "Call" ? <Phone size={16} /> : <CalendarClock size={16} />}</span><div><strong>{activity.title}</strong><p>{activity.customerName} · {activity.note || activity.phone}</p></div></div>{activity.status === "overdue" ? <span className="danger-label"><CircleAlert size={14} />Overdue</span> : <span className="quiet-label">{activity.type}</span>}<div className="row-actions"><button onClick={() => onOpen(activity.leadId)}>Open</button><button className="check-button" aria-label="Complete" onClick={() => onComplete(activity.id)}><Check size={17} /></button></div></div>)}</div>
  </section><aside className="today-aside">
    <div className="attention"><span className="eyebrow">Needs attention</span><strong>{noNext.length + activities.filter((activity) => activity.status === "overdue").length}</strong><p>items could break the follow-up chain.</p></div>
    <QueuePreview title="No next action" leads={noNext} onOpen={onOpen} onAll={() => onNavigate("mine")} />
    <QueuePreview title="New enquiries" leads={unclaimed.slice(0, 3)} count={unclaimed.length} onOpen={onOpen} onAll={() => onNavigate("unclaimed")} />
  </aside></div>;
}

function QueuePreview({ title, leads, count = leads.length, onOpen, onAll }: { title: string; leads: Lead[]; count?: number; onOpen: (id: string) => void; onAll: () => void }) {
  return <div className="queue-preview"><div className="section-title compact"><h3>{title}<b>{count}</b></h3><button onClick={onAll}>View all</button></div>{leads.map((lead) => <button className="mini-lead" key={lead.id} onClick={() => onOpen(lead.id)}><Priority priority={lead.priority} /><div><strong>{lead.customerName}</strong><span>{lead.stage} · {lead.city}</span></div><ChevronRight size={15} /></button>)}</div>;
}
