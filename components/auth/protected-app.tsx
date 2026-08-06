"use client";

import * as React from "react";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "@/contexts/auth-context";
import { AuthLoadingScreen } from "./auth-loading-screen";

export function ProtectedApp({ children, roles }: { children: React.ReactNode; roles?: string[] }) {
  const { status, hasRole } = useAuth();
  const pathname = usePathname();
  const router = useRouter();

  React.useEffect(() => {
    if (status !== "anonymous") return;
    const requestedPath = `${pathname}${window.location.search}`;
    router.replace(`/login?next=${encodeURIComponent(requestedPath)}`);
  }, [pathname, router, status]);

  if (status !== "authenticated") return <AuthLoadingScreen />;
  if (roles?.length && !hasRole(...roles)) return <main className="grid min-h-svh place-items-center bg-[var(--bg)] p-6"><div className="max-w-sm text-center"><h1 className="m-0 text-xl font-bold text-[var(--text)]">Access restricted</h1><p className="mt-2 text-[13px] leading-5 text-[var(--muted)]">Your account does not have permission to open this workspace.</p></div></main>;
  return children;
}
