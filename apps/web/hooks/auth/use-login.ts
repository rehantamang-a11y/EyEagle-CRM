"use client";

import { useMutation } from "@tanstack/react-query";
import { useAuth } from "@/contexts/auth-context";
import { authService } from "@/services/auth/auth.service";

export function useLogin() {
  const { authenticate } = useAuth();
  return useMutation({ mutationFn: authService.login, onSuccess: authenticate });
}
