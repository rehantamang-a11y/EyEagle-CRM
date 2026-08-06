"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ClipboardList, FileText, Inbox, Users } from "lucide-react";
import { SessionSummary } from "@/components/auth/session-summary";
import { withBasePath } from "@/lib/app-path";

const links = [
  { href: "/new-enquiries", label: "New enquiries", icon: Inbox },
  { href: "/my-work?filter=ALL", path: "/my-work", label: "My work", icon: ClipboardList },
  { href: "/all-sales?filter=ALL", path: "/all-sales", label: "All sales", icon: Users },
];

export function CrmSidebar() {
  const pathname = usePathname();

  return <aside className="desk-sidebar">
    <div className="sidebar-brand">
      <span><img src={withBasePath("/logo.svg")} alt="Eyeagle" /></span>
      <div><strong>Eyeagle</strong><small>Sales desk</small></div>
    </div>
    <div className="sidebar-heading"><span>Work</span><small>Keep the next promise visible.</small></div>
    <nav>
      {links.map(({ href, path = href, label, icon: Icon }) => <Link key={href} href={href} className={pathname === path ? "active" : ""}>
        <span><Icon size={16} />{label}</span>
      </Link>)}
    </nav>
    <div className="sidebar-footer">
      <div className="sidebar-source"><FileText size={16} /><div><strong>Jotform intake</strong><small>Manual refresh only</small></div></div>
      <SessionSummary />
    </div>
  </aside>;
}
