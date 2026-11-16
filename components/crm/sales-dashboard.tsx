"use client";

import { useMemo, useState, type KeyboardEvent, type ReactNode } from "react";
import Link from "next/link";
import { ArrowRight, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useDashboardOpportunities } from "@/hooks/opportunities/use-dashboard-opportunities";
import { useMyWorkOpportunities } from "@/hooks/opportunities/use-my-work-opportunities";
import { crmListHref } from "@/lib/crm-routes";
import { ApiError } from "@/services/api/client";
import { buildMyWorkDashboard, buildSalesDashboard } from "@/services/opportunities/sales-dashboard";
import styles from "./sales-dashboard.module.css";

const numberFormat = new Intl.NumberFormat("en-IN");
const percentFormat = new Intl.NumberFormat("en-IN", { style: "percent", maximumFractionDigits: 1 });
const followUpFormat = new Intl.DateTimeFormat("en-IN", {
  month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit",
});
const chartFormat = new Intl.DateTimeFormat("en-IN", { month: "short", day: "numeric", timeZone: "UTC" });
const dashboardTabs = [
  { id: "team", label: "Team overview" },
  { id: "personal", label: "My work" },
] as const;

type DashboardTab = (typeof dashboardTabs)[number]["id"];
type PipelineSummary = ReturnType<typeof buildMyWorkDashboard>;
type SalesView = "all-sales" | "my-work";

function Metric({ label, count, description, href, tone }: {
  label: string;
  count: number;
  description: string;
  href?: string;
  tone?: "active" | "intake";
}) {
  return <div className={styles.metric} data-tone={tone}>
    <p>{label}</p>
    <strong>{numberFormat.format(count)}</strong>
    <small>{description}</small>
    {href && <Link href={href} className={styles.metricLink} aria-label={`View ${label.toLowerCase()}`}><ArrowRight size={16} /></Link>}
  </div>;
}

function Panel({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return <section className={styles.panel}>
    <header><h3>{title}</h3>{description && <p>{description}</p>}</header>
    {children}
  </section>;
}

function CountRows({ rows, empty, limit }: {
  rows: { label: string; count: number; tone?: "danger" | "success" }[];
  empty: string;
  limit?: number;
}) {
  if (!rows.length) return <p className={styles.empty}>{empty}</p>;
  const max = Math.max(1, ...rows.map(({ count }) => count));
  return <ul className={styles.bars}>
    {rows.slice(0, limit).map(({ label, count, tone }) => <li key={label}>
      <span>{label}</span>
      <strong>{numberFormat.format(count)}</strong>
      <div className={styles.barTrack} aria-hidden="true">
        <div data-tone={tone} style={{ width: `${(count / max) * 100}%` }} />
      </div>
    </li>)}
  </ul>;
}

function FollowUpWorkload({ snapshot, view }: { snapshot: PipelineSummary; view: SalesView }) {
  const rows = [
    { label: "Overdue", count: snapshot.overdue, tone: "danger" as const },
    { label: "Later today", count: snapshot.dueToday },
    { label: "Upcoming", count: snapshot.upcoming },
    { label: "Without a next-action date", count: snapshot.unscheduled },
  ];
  if (view === "all-sales") rows.push({ label: "Active without an owner", count: snapshot.activeUnassigned });

  return <Panel title="Follow-up workload" description="Scheduled next actions for active leads.">
    <CountRows empty="No follow-up data." rows={rows} />
    <div className={styles.panelFooter}>
      <Link className={styles.textLink} href={crmListHref(view, "DUE")}>Open due queue ({numberFormat.format(snapshot.due)}) <ArrowRight size={14} /></Link>
      <Link className={styles.textLink} href={crmListHref(view, "FOLLOW_UPS")}>Open follow-ups ({numberFormat.format(snapshot.followUps)}) <ArrowRight size={14} /></Link>
    </div>
  </Panel>;
}

function SalesOutcomes({ snapshot, view }: { snapshot: PipelineSummary; view: SalesView }) {
  return <Panel title="Sales outcomes" description={view === "my-work" ? `${numberFormat.format(snapshot.inactive)} inactive leads assigned to you.` : "Outcomes recorded by the sales team."}>
    <CountRows empty="No sales outcomes recorded." rows={[
      { label: "Sold", count: snapshot.sold, tone: "success" },
      { label: "Not proceeding", count: snapshot.notProceeding },
      { label: "Other inactive", count: snapshot.closedOther },
    ]} />
    <div className={styles.panelFooter}>
      <span>Win rate among decided leads <strong>{snapshot.closeRate === null ? "—" : percentFormat.format(snapshot.closeRate)}</strong></span>
      <Link className={styles.textLink} href={crmListHref(view, "CLOSED")}>Open closed leads <ArrowRight size={14} /></Link>
    </div>
  </Panel>;
}

function ScheduledActions({ overdue, actions, view }: { overdue?: boolean; actions: PipelineSummary["attention"]; view: SalesView }) {
  const personal = view === "my-work";
  return <Panel title={overdue ? "Oldest overdue actions" : "Next scheduled actions"}>
    {actions.length ? <ul className={styles.attention}>
      {actions.map(({ id, name, owner, label, at }) => {
        const context = personal ? label : owner;
        return <li key={id}>
          <Link href={`/opportunities/${encodeURIComponent(id)}?source=${personal ? view : "dashboard"}`}><strong>{name}</strong><ArrowRight size={14} /></Link>
          <span>{context && <>{context} · </>}<time data-overdue={overdue} dateTime={new Date(at).toISOString()}>{followUpFormat.format(at)}</time></span>
        </li>;
      })}
    </ul> : <p className={styles.empty}>{overdue ? "No overdue actions with a scheduled date." : "No upcoming actions with a scheduled date."}</p>}
  </Panel>;
}

function TeamOverview({ snapshot }: { snapshot: ReturnType<typeof buildSalesDashboard> }) {
  return <>
      <div className={styles.overview}>
        <Link className={styles.textLink} href={crmListHref("all-sales")}>Open all sales <ArrowRight size={14} /></Link>
      </div>
      <div className={styles.metrics}>
        <Metric label="All leads to date" count={snapshot.total} description="Unique opportunity records" />
        <Metric label="Active leads" count={snapshot.active} description="Open, due or in follow-up" tone="active" />
        <Metric label="Inactive leads" count={snapshot.inactive} description="Closed, sold or no longer proceeding" />
        <Metric label="New enquiries" count={snapshot.newEnquiries} description="Waiting for ownership" tone="intake" href="/new-enquiries" />
      </div>
      <div className={styles.columns}>
        <Panel title="Pipeline status" description={snapshot.otherStatus ? `${snapshot.otherStatus} leads have other CRM statuses.` : "Current stage of each opportunity."}>
          <CountRows rows={snapshot.stages.map((row) => ({ ...row, tone: row.label === "Sold" ? "success" : row.label === "Due" ? "danger" : undefined }))} empty="No statuses recorded." />
        </Panel>
        <FollowUpWorkload snapshot={snapshot} view="all-sales" />
        <SalesOutcomes snapshot={snapshot} view="all-sales" />
        <ScheduledActions overdue actions={snapshot.attention} view="all-sales" />
      </div>
      <Panel title="Workload by owner" description="Current workload and recorded outcomes, grouped by the owner shown in All sales.">
        {snapshot.owners.length ? <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead><tr><th scope="col">Owner</th><th scope="col">Active</th><th scope="col">Due</th><th scope="col">Overdue</th><th scope="col">Sold</th><th scope="col">Not proceeding</th></tr></thead>
            <tbody>{snapshot.owners.map((owner) => <tr key={owner.name}>
              <th scope="row">{owner.name}</th>
              <td>{numberFormat.format(owner.active)}</td><td>{numberFormat.format(owner.due)}</td>
              <td data-attention={owner.overdue > 0}>{numberFormat.format(owner.overdue)}</td>
              <td>{numberFormat.format(owner.sold)}</td><td>{numberFormat.format(owner.notProceeding)}</td>
            </tr>)}</tbody>
          </table>
        </div> : <p className={styles.empty}>No owner workload or outcomes to display.</p>}
      </Panel>
      <div className={styles.overview}>
        <div><h2>Enquiry intake</h2><p>Submission details from the {numberFormat.format(snapshot.intakeCount)} enquiries currently waiting for ownership in the intake queue.</p></div>
        <Link className={styles.textLink} href="/new-enquiries">Open new enquiries <ArrowRight size={14} /></Link>
      </div>
      <div className={styles.columns}>
        <Panel title="Submission dates" description="Enquiries still waiting, grouped into seven-day periods in IST.">
          <CountRows empty="No dated enquiries." rows={snapshot.intakeAge.buckets.map(({ from, to, count }) => ({
            label: `${chartFormat.format(new Date(from))} – ${chartFormat.format(new Date(to))}`, count,
          }))} />
          <div className={styles.panelFooter}>
            <span>Waiting 7+ days <strong>{numberFormat.format(snapshot.intakeAge.olderThanWeek)}</strong></span>
            <span>Date unavailable <strong>{numberFormat.format(snapshot.intakeAge.unknownDate)}</strong></span>
          </div>
        </Panel>
        <Panel title="Stated interest" description={`${numberFormat.format(snapshot.interested)} unclaimed enquiries named a specific topic. Each enquiry can include several topics.`}>
          <CountRows rows={snapshot.topics} limit={8} empty="No specific interest topics recorded." />
          {snapshot.concerns.length > 0 && <div className={styles.subsection}>
            <h4>Reported concerns</h4><CountRows rows={snapshot.concerns} limit={5} empty="No concerns recorded." />
          </div>}
        </Panel>
        <Panel title="Enquiry sources">
          <CountRows rows={snapshot.sources} limit={8} empty="No enquiries awaiting ownership." />
        </Panel>
        <Panel title="Top enquiry locations">
          <CountRows rows={snapshot.locations} limit={8} empty="No enquiries awaiting ownership." />
        </Panel>
      </div>
  </>;
}

function MyWorkOverview({ snapshot }: { snapshot: PipelineSummary }) {
  return <>
    <div className={styles.overview}>
      <div><h2>My pipeline</h2><p>Opportunities assigned to your account.</p></div>
      <Link className={styles.textLink} href={crmListHref("my-work")}>Open my work queue <ArrowRight size={14} /></Link>
    </div>
    <div className={styles.metrics}>
      <Metric label="Assigned leads" count={snapshot.total} description="All leads you own" />
      <Metric label="Active leads" count={snapshot.active} description="Open, due or in follow-up" tone="active" />
      <Metric label="Due" count={snapshot.due} description="Marked due by the CRM" tone="intake" href={crmListHref("my-work", "DUE")} />
      <Metric label="Follow-ups" count={snapshot.followUps} description="Leads in follow-up" href={crmListHref("my-work", "FOLLOW_UPS")} />
    </div>
    <div className={styles.columns}>
      <ScheduledActions overdue actions={snapshot.attention} view="my-work" />
      <ScheduledActions actions={snapshot.scheduled} view="my-work" />
      <FollowUpWorkload snapshot={snapshot} view="my-work" />
      <SalesOutcomes snapshot={snapshot} view="my-work" />
    </div>
  </>;
}

export function SalesDashboard() {
  const [tab, setTab] = useState<DashboardTab>("team");
  const personal = tab === "personal";
  const team = useDashboardOpportunities(!personal);
  const myWork = useMyWorkOpportunities(personal);
  const query = personal ? myWork : team;
  const { error, isFetching: fetching, refetch } = query;
  const restricted = error instanceof ApiError && error.status === 403;
  const refresh = () => void refetch();
  const teamSnapshot = useMemo(() => team.data
    ? buildSalesDashboard(team.data.sales, team.data.intake, new Date(team.dataUpdatedAt))
    : null, [team.data, team.dataUpdatedAt]);
  const mySnapshot = useMemo(() => myWork.data
    ? buildMyWorkDashboard(myWork.data, new Date(myWork.dataUpdatedAt))
    : null, [myWork.data, myWork.dataUpdatedAt]);
  const snapshot = personal ? mySnapshot : teamSnapshot;

  function navigateTabs(event: KeyboardEvent<HTMLDivElement>) {
    const index = dashboardTabs.findIndex(({ id }) => id === tab);
    const last = dashboardTabs.length - 1;
    const offsets: Record<string, number> = { ArrowLeft: index === 0 ? last : index - 1, ArrowRight: index === last ? 0 : index + 1, Home: 0, End: last };
    const nextTab = dashboardTabs[offsets[event.key]];
    if (!nextTab) return;
    event.preventDefault();
    event.currentTarget.querySelector<HTMLButtonElement>(`#dashboard-tab-${nextTab.id}`)?.focus();
    setTab(nextTab.id);
  }

  return <section className={`workspace ${styles.dashboard}`}>
    <div className="page-heading">
      <div><h1>Sales dashboard</h1><p>Lead status, follow-ups and sales outcomes.</p></div>
      <Button className={styles.refresh} type="button" variant="outline" size="sm" disabled={fetching} onClick={refresh}>
        <RefreshCw size={15} className={fetching ? "spin" : undefined} />{fetching ? "Refreshing…" : "Refresh dashboard"}
      </Button>
    </div>
    <div className={`detail-tabs ${styles.tabs}`} role="tablist" aria-label="Dashboard views" onKeyDown={navigateTabs}>
      {dashboardTabs.map(({ id, label }) => <button key={id} type="button" id={`dashboard-tab-${id}`} role="tab" aria-selected={tab === id} tabIndex={tab === id ? 0 : -1} aria-controls={`dashboard-panel-${id}`} onClick={() => setTab(id)}>{label}</button>)}
    </div>
    {dashboardTabs.map(({ id }) => <div key={id} role="tabpanel" id={`dashboard-panel-${id}`} aria-labelledby={`dashboard-tab-${id}`} tabIndex={0} hidden={tab !== id}>
      {tab === id && (error ? <div className="desk-empty" role="alert">
        <strong>{restricted ? "Dashboard access restricted" : personal ? "Could not load my work" : "Could not load dashboard"}</strong>
        <span>{restricted && !personal ? "Your account needs access to both All sales and New enquiries." : error.message}</span>
        <Button className="mt-3" variant="outline" size="sm" onClick={refresh} disabled={fetching}>Try again</Button>
      </div> : !snapshot ? <div className="desk-empty" role="status">
        <RefreshCw className="spin" size={27} /><strong>{personal ? "Loading my work" : "Loading dashboard"}</strong>
      </div> : !snapshot.total ? <div className="desk-empty" role="status">
        <strong>{personal ? "No leads assigned to you" : "No leads yet"}</strong>
        <span>{personal ? "Leads will appear here once they are assigned to your account." : "Dashboard totals will appear when the CRM has enquiries or sales records."}</span>
        <Link className={styles.textLink} href={personal ? crmListHref("my-work") : "/new-enquiries"}>{personal ? "Open my work queue" : "Open new enquiries"} <ArrowRight size={14} /></Link>
      </div> : <div className={styles.content} aria-busy={fetching}>
        {personal ? mySnapshot && <MyWorkOverview snapshot={mySnapshot} /> : teamSnapshot && <TeamOverview snapshot={teamSnapshot} />}
      </div>)}
    </div>)}
  </section>;
}
