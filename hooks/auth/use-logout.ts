"use client";

import { useMutation } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useAuth } from "@/contexts/auth-context";
import { authService } from "@/services/auth/auth.service";

export function useLogout() {
  const { clearSession } = useAuth();
  const router = useRouter();
  return useMutation({
    mutationFn: authService.logout,
    onSettled: () => {
      clearSession();
      router.replace("/login");
    },
  });
}
