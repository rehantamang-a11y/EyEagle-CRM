import type { ComponentType, ReactNode } from "react";
import { Activity, Bell, ChevronRight, Command, Inbox, LayoutDashboard, ListFilter, Menu, Plus, Search, Settings, UserRound, UsersRound, X } from "lucide-react";
import type { CRMView } from "./types";

const navigation: Array<{ id: CRMView; label: string; icon: ComponentType<{ size?: number }> }> = [
  { id: "today", label: "Today", icon: LayoutDashboard },
  { id: "unclaimed", label: "Unclaimed leads", icon: Inbox },
  { id: "mine", label: "My leads", icon: UserRound },
  { id: "customers", label: "Customers", icon: UsersRound },
  { id: "pipeline", label: "Pipeline", icon: ListFilter },
  { id: "team", label: "Team overview", icon: Activity },
  { id: "settings", label: "Settings", icon: Settings },
];

export function CRMLayout({ children, view, query, mobileOpen, unclaimedCount, needsActionCount, onViewChange, onQueryChange, onMobileOpenChange }: {
  children: ReactNode;
  view: CRMView;
  query: string;
  mobileOpen: boolean;
  unclaimedCount: number;
  needsActionCount: number;
  onViewChange: (view: CRMView) => void;
  onQueryChange: (query: string) => void;
  onMobileOpenChange: (open: boolean) => void;
}) {
  const navigate = (target: CRMView) => { onViewChange(target); onMobileOpenChange(false); };
  return <div className="app-shell">
    <aside className={`sidebar ${mobileOpen ? "sidebar-open" : ""}`}>
      <div className="brand">
        <div className="brand-mark"><img src="/logo.svg" alt="Eyeagle" /></div>
        <div><strong>Eyeagle CRM</strong><span>Customer follow-up</span></div>
        <button aria-label="Close navigation" className="mobile-close" onClick={() => onMobileOpenChange(false)}><X size={18} /></button>
      </div>
      <nav>{navigation.map((item) => <button key={item.id} className={view === item.id ? "nav-active" : ""} onClick={() => navigate(item.id)}>
        <item.icon size={18} /><span>{item.label}</span>
        {item.id === "unclaimed" && <b>{unclaimedCount}</b>}
        {item.id === "mine" && needsActionCount > 0 && <i />}
      </button>)}</nav>
      <div className="sidebar-bottom">
        <div className="health"><span /><div><strong>Intake is healthy</strong><small>Last enquiry 8 min ago</small></div></div>
        <button className="profile"><div className="avatar">AM</div><div><strong>Asha Mehta</strong><small>Team member</small></div><ChevronRight size={16} /></button>
      </div>
    </aside>
    <main>
      <header className="topbar">
        <button aria-label="Open navigation" className="menu-button" onClick={() => onMobileOpenChange(true)}><Menu size={20} /></button>
        <div className="global-search"><Search size={17} /><input aria-label="Search customers" placeholder="Search customer or phone" value={query} onChange={(event) => onQueryChange(event.target.value)} /><kbd><Command size={12} /> K</kbd></div>
        <button aria-label="Notifications" className="icon-button"><Bell size={19} /><span /></button>
        <button className="primary small" onClick={() => navigate("unclaimed")}><Plus size={17} />New lead</button>
      </header>
      {children}
    </main>
  </div>;
}
