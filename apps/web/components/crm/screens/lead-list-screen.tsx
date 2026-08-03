import { ChevronRight, Sparkles } from "lucide-react";
import type { Lead } from "@/lib/demo-data";
import { age, day, initials, Priority, Stage, time } from "../shared/lead-format";

export function LeadListScreen({ leads, mode, onOpen, onClaim }: {
  leads: Lead[];
  mode: "claim" | "mine" | "all";
  onOpen: (lead: Lead) => void;
  onClaim: (lead: Lead) => void;
}) {
  return <div className="table-wrap">
    <div className="table-caption"><span>{leads.length} records</span><span>Updated just now</span></div>
    <div className="lead-table">
      <div className="table-head"><span>Customer</span><span>Stage / source</span><span>{mode === "claim" ? "Received" : "Next action"}</span><span>Priority</span><span /></div>
      {leads.map((lead) => <div className="table-row" key={lead.id} onClick={() => onOpen(lead)}>
        <div className="customer-cell"><div className="initials">{initials(lead.customerName)}</div><div><strong>{lead.customerName}</strong><span>{lead.phone} · {lead.city}</span><p>{lead.summary}</p></div></div>
        <div><Stage name={lead.stage} /><small>{lead.source}{lead.ownerName ? ` · ${lead.ownerName}` : ""}</small></div>
        <div className={!lead.nextActivityAt && mode !== "claim" ? "missing" : ""}>{mode === "claim"
          ? <><strong>{age(lead.createdAt)}</strong><small>{lead.preferred || "No preference"}</small></>
          : lead.nextActivityAt
            ? <><strong>{day(lead.nextActivityAt)}</strong><small>{time(lead.nextActivityAt)}</small></>
            : <><strong>No next action</strong><small>Schedule required</small></>}</div>
        <Priority priority={lead.priority} />
        <div>{mode === "claim" ? <button className="claim-button" onClick={(event) => { event.stopPropagation(); onClaim(lead); }}>Pick up</button> : <ChevronRight size={17} />}</div>
      </div>)}
      {!leads.length && <div className="empty"><Sparkles size={24} /><strong>Nothing waiting here</strong><p>Your filters are clear.</p></div>}
    </div>
  </div>;
}
