"use client";

import { LogOut } from "lucide-react";
import { useAuth } from "@/contexts/auth-context";
import { useLogout } from "@/hooks/auth/use-logout";

export function SessionSummary() {
  const { user } = useAuth();
  const logout = useLogout();
  if (!user) return null;
  const initials = user.name.split(" ").filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toUpperCase();
  const role = user.roles[0]?.replace(/_/g, " ") || "CRM user";

  return <div className="mt-2 flex items-center gap-2 border-t border-[var(--app-nav-border)] pt-3" title={`${user.email} · ${role}`}>
    <span className="grid size-8 shrink-0 place-items-center rounded-full bg-[var(--accent-soft)] text-[10px] font-bold text-[var(--accent)]">{initials}</span>
    <span className="min-w-0 flex-1">
      <strong className="block truncate text-xs text-white">{user.name}</strong>
      <small className="mt-0.5 block truncate text-[10px] text-[var(--app-nav-text-tertiary)]">{user.email}</small>
      <small className="mt-0.5 block truncate text-[9px] capitalize text-[var(--app-nav-text-tertiary)]">{role}</small>
    </span>
    <button type="button" className="grid size-9 shrink-0 place-items-center rounded-md text-[var(--app-nav-text-tertiary)] transition-colors hover:bg-[var(--app-nav-item-bg-active)] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white" onClick={() => logout.mutate()} disabled={logout.isPending} aria-label="Sign out">
      <LogOut size={15} />
    </button>
  </div>;
}
