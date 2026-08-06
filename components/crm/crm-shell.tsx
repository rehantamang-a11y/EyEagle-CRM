import type { ReactNode } from "react";
import { CrmSidebar } from "./crm-sidebar";

export function CrmShell({ children, modal }: { children: ReactNode; modal?: ReactNode }) {
  return <div className="desk-shell minimal-desk">
    <CrmSidebar />
    <main className="desk-frame"><div className="desk-main">{children}</div></main>
    {modal}
  </div>;
}
