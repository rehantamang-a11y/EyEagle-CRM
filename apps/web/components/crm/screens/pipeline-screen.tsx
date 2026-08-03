import { stages, type Lead } from "@/lib/demo-data";
import { day, Priority, time } from "../shared/lead-format";

export function PipelineScreen({ leads, onOpen }: { leads: Lead[]; onOpen: (lead: Lead) => void }) {
  return <div className="pipeline">
    <div className="pipeline-summary"><div><strong>{leads.filter((lead) => lead.status !== "unclaimed").length}</strong><span>Open leads</span></div><div><strong>{leads.filter((lead) => !lead.nextActivityAt && lead.status === "active").length}</strong><span>No next action</span></div><div><strong>2.8h</strong><span>Avg. first response</span></div></div>
    <div className="pipeline-scroll">{stages.slice(0, 9).map((stage) => { const stageLeads = leads.filter((lead) => lead.stage === stage); return <section className="pipeline-column" key={stage}><header><h3>{stage}</h3><span>{stageLeads.length}</span></header>{stageLeads.map((lead) => <button className="pipeline-lead" onClick={() => onOpen(lead)} key={lead.id}><div><Priority priority={lead.priority} /><small>{lead.city}</small></div><strong>{lead.customerName}</strong><p>{lead.nextActivityAt ? `${day(lead.nextActivityAt)} · ${time(lead.nextActivityAt)}` : "No next action"}</p><span>{lead.ownerName || "Unclaimed"}</span></button>)}</section>; })}</div>
  </div>;
}
