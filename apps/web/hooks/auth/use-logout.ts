"use client";

import { useMutation } from "@tanstack/react-query";
import { useAuth } from "@/contexts/auth-context";
import { authService } from "@/services/auth/auth.service";

export function useLogout() {
  const { clearSession } = useAuth();
  return useMutation({ mutationFn: authService.logout, onSettled: clearSession });
}
