"use client";

import { useState, type ReactNode } from "react";
import { Menu } from "lucide-react";
import { CrmSidebar } from "./crm-sidebar";

export function CrmShell({ children, modal }: { children: ReactNode; modal?: ReactNode }) {
  const [mobileNavigationOpen, setMobileNavigationOpen] = useState(false);

  return <div className="desk-shell minimal-desk">
    <CrmSidebar mobileOpen={mobileNavigationOpen} onNavigate={() => setMobileNavigationOpen(false)} />
    {mobileNavigationOpen && <button className="sidebar-scrim" type="button" aria-label="Close navigation" onClick={() => setMobileNavigationOpen(false)} />}
    <main className="desk-frame">
      <div className="mobile-desk-bar"><button type="button" aria-label="Open navigation" onClick={() => setMobileNavigationOpen(true)}><Menu size={18} /></button><strong>Eyeagle sales desk</strong></div>
      <div className="desk-main">{children}</div>
    </main>
    {modal}
  </div>;
}
