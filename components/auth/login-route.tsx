"use client";

import { useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@/contexts/auth-context";
import { safeNextPath } from "@/lib/crm-routes";
import { AuthLoadingScreen } from "./auth-loading-screen";
import { LoginScreen } from "./login-screen";

export function LoginRoute() {
  const { status } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();

  useEffect(() => {
    if (status === "authenticated") router.replace(safeNextPath(searchParams.get("next")));
  }, [router, searchParams, status]);

  if (status !== "anonymous") return <AuthLoadingScreen />;
  return <LoginScreen />;
}
