import { ArrowLeft, CalendarClock, Phone, X } from "lucide-react";
import type { Activity, Lead } from "@/lib/demo-data";
import { day, initials, Priority, Stage, time } from "../shared/lead-format";

export function LeadDrawer({ lead, activities, onClose, onClaim, onSchedule }: { lead: Lead; activities: Activity[]; onClose: () => void; onClaim: () => void; onSchedule: () => void }) {
  return <div className="overlay" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><aside className="drawer">
    <header><button aria-label="Back" onClick={onClose}><ArrowLeft size={19} /></button><span>Customer profile</span><button aria-label="Close customer profile" onClick={onClose}><X size={19} /></button></header>
    <div className="drawer-body">
      <div className="profile-title"><div className="large-initials">{initials(lead.customerName)}</div><div><h2>{lead.customerName}</h2><p>{lead.phone} · {lead.city}</p></div></div>
      <div className="profile-state"><Stage name={lead.stage} /><span>{lead.ownerName || "Unclaimed"}</span><Priority priority={lead.priority} /></div>
      {lead.status === "unclaimed" ? <button className="primary full" onClick={onClaim}>Pick up this lead</button> : <div className="profile-actions"><button className="primary" onClick={onSchedule}><CalendarClock size={16} />Schedule follow-up</button><button className="secondary"><Phone size={16} />Call</button></div>}
      <section className={`next-card ${lead.nextActivityAt ? "" : "warning"}`}><span className="eyebrow">Next action</span>{lead.nextActivityAt ? <><strong>{day(lead.nextActivityAt)} at {time(lead.nextActivityAt)}</strong><p>Reminder one day and 30 minutes before</p></> : <><strong>No next action scheduled</strong><p>This lead can fall out of the follow-up chain.</p>{lead.status !== "unclaimed" && <button onClick={onSchedule}>Schedule now</button>}</>}</section>
      <section className="profile-section"><h3>Enquiry</h3><p>{lead.summary}</p><dl><div><dt>Source</dt><dd>{lead.source}</dd></div><div><dt>Preferred time</dt><dd>{lead.preferred || "Not provided"}</dd></div><div><dt>Owner</dt><dd>{lead.ownerName || "Unclaimed"}</dd></div></dl></section>
      <section className="profile-section"><h3>Timeline</h3><div className="timeline"><div><i /><span><strong>Lead created</strong><small>{day(lead.createdAt)} · {time(lead.createdAt)}</small></span></div>{activities.map((activity) => <div key={activity.id}><i /><span><strong>{activity.title}</strong><small>{activity.status} · {day(activity.scheduledStart)} at {time(activity.scheduledStart)}</small></span></div>)}{lead.lastContactedAt && <div><i /><span><strong>Customer contacted</strong><small>{day(lead.lastContactedAt)} · {time(lead.lastContactedAt)}</small></span></div>}</div></section>
    </div>
  </aside></div>;
}
