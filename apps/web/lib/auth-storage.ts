import type { AuthSession } from "@/services/auth/auth.types";

const AUTH_STORAGE_KEY = "eyeagle.crm.auth.v1";

export function readStoredAuth(): AuthSession | null {
  if (typeof window === "undefined") return null;
  try {
    const value = JSON.parse(window.sessionStorage.getItem(AUTH_STORAGE_KEY) || "null") as AuthSession | null;
    if (!value?.user?.id || !value.user.email || !Array.isArray(value.user.roles)) return null;
    return value;
  } catch {
    window.sessionStorage.removeItem(AUTH_STORAGE_KEY);
    return null;
  }
}

export function storeAuth(session: AuthSession) {
  if (typeof window !== "undefined") window.sessionStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(session));
}

export function clearStoredAuth() {
  if (typeof window !== "undefined") window.sessionStorage.removeItem(AUTH_STORAGE_KEY);
}
