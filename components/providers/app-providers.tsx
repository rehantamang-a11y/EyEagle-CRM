"use client";

import * as React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AuthProvider } from "@/contexts/auth-context";

export function AppProviders({ children }: { children: React.ReactNode }) {
  const [queryClient] = React.useState(() => new QueryClient({
    defaultOptions: {
      queries: { retry: 1, refetchOnWindowFocus: false, staleTime: 30_000 },
      mutations: { retry: false },
    },
  }));

  return <QueryClientProvider client={queryClient}><AuthProvider>{children}</AuthProvider></QueryClientProvider>;
}
