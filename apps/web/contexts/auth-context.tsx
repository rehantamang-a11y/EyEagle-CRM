"use client";

import * as React from "react";
import { useQueryClient } from "@tanstack/react-query";
import { clearStoredAuth, readStoredAuth, storeAuth } from "@/lib/auth-storage";
import { setApiAccessToken } from "@/services/api/client";
import { authService } from "@/services/auth/auth.service";
import type { AuthSession, AuthUser } from "@/services/auth/auth.types";

type AuthStatus = "initializing" | "authenticated" | "anonymous";
type AuthContextValue = {
  status: AuthStatus;
  user: AuthUser | null;
  authenticate: (session: AuthSession) => void;
  clearSession: () => void;
  hasRole: (...roles: string[]) => boolean;
  hasPermission: (permission: string) => boolean;
};

const AuthContext = React.createContext<AuthContextValue | null>(null);
const normalize = (value: string) => value.replace(/^ROLE_/i, "").toLowerCase();

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const queryClient = useQueryClient();
  const [status, setStatus] = React.useState<AuthStatus>("initializing");
  const [session, setSession] = React.useState<AuthSession | null>(null);

  const clearSession = React.useCallback(() => {
    clearStoredAuth();
    setApiAccessToken(null);
    setSession(null);
    setStatus("anonymous");
    queryClient.clear();
  }, [queryClient]);

  React.useEffect(() => {
    const stored = readStoredAuth();
    if (!stored) {
      setStatus("anonymous");
      return;
    }

    let active = true;
    setApiAccessToken(stored.accessToken);
    void queryClient.fetchQuery({
      queryKey: ["auth", "session"],
      queryFn: () => authService.verifySession(stored),
      staleTime: 0,
    }).then((verified) => {
      queryClient.removeQueries({ queryKey: ["auth", "session"], exact: true });
      if (!active) return;
      storeAuth(verified);
      setApiAccessToken(verified.accessToken);
      setSession(verified);
      queryClient.setQueryData(["auth", "me"], verified.user);
      setStatus("authenticated");
    }).catch(() => {
      queryClient.removeQueries({ queryKey: ["auth", "session"], exact: true });
      if (active) clearSession();
    });

    return () => { active = false; };
  }, [clearSession, queryClient]);

  React.useEffect(() => {
    window.addEventListener("eyeagle:auth-expired", clearSession);
    return () => window.removeEventListener("eyeagle:auth-expired", clearSession);
  }, [clearSession]);

  const authenticate = React.useCallback((nextSession: AuthSession) => {
    storeAuth(nextSession);
    setApiAccessToken(nextSession.accessToken);
    queryClient.setQueryData(["auth", "me"], nextSession.user);
    setSession(nextSession);
    setStatus("authenticated");
  }, [queryClient]);

  const value = React.useMemo<AuthContextValue>(() => ({
    status,
    user: session?.user ?? null,
    authenticate,
    clearSession,
    hasRole: (...roles) => roles.some((role) => session?.user.roles.map(normalize).includes(normalize(role))),
    hasPermission: (permission) => session?.user.permissions.map(normalize).includes(normalize(permission)) ?? false,
  }), [authenticate, clearSession, session, status]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = React.useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used within AuthProvider");
  return context;
}
