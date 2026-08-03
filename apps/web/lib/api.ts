// The rest of the app still runs on demo-data.ts — this is the first real call
// to the CRM API. Next.js only inlines NEXT_PUBLIC_* vars referenced literally,
// so this exact expression (not a dynamic lookup) is required.
const API_BASE_URL = process.env.NEXT_PUBLIC_CRM_API_URL ?? "http://localhost:4000/api/v1";

export type ApiError = { code: string; message: string };
export type ApiResult<T> = { ok: true; data: T } | { ok: false; error: ApiError };

export type JotformSyncResult = {
  fetched: number;
  created: number;
  skipped: number;
  rejected: Array<{ submissionId: string; reason: string }>;
  mappingWarnings: Array<{ submissionId: string; unmapped: string[] }>;
};

export type JotformSyncStatus = {
  configured: boolean;
  status: {
    formId: string;
    lastSyncedSubmittedAt: string | null;
    lastSyncedAt: string | null;
    lastRunCreated: number;
    lastRunSkipped: number;
    lastRunError: string | null;
  } | null;
};

/**
 * credentials: "include" sends the httpOnly session cookie. There is no real
 * login flow wired up yet, so today this will most likely come back as
 * 401 UNAUTHENTICATED — that's surfaced as-is rather than hidden, since it's
 * accurate: this button will start working the moment auth is wired, with no
 * change needed here.
 */
async function apiRequest<T>(path: string, init?: RequestInit): Promise<ApiResult<T>> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, { credentials: "include", ...init });
  } catch {
    return { ok: false, error: { code: "NETWORK_ERROR", message: `Could not reach the API at ${API_BASE_URL}.` } };
  }

  const body = await response.json().catch(() => null);
  if (!response.ok) {
    return {
      ok: false,
      error: body?.error ?? { code: "UNKNOWN", message: `Request failed with status ${response.status}.` },
    };
  }
  return { ok: true, data: body as T };
}

export async function syncJotform(): Promise<ApiResult<JotformSyncResult>> {
  const result = await apiRequest<{ data: JotformSyncResult }>("/intake/jotform/sync", { method: "POST" });
  return result.ok ? { ok: true, data: result.data.data } : result;
}

export async function jotformSyncStatus(): Promise<ApiResult<JotformSyncStatus>> {
  const result = await apiRequest<{ data: JotformSyncStatus["status"]; configured: boolean }>("/intake/jotform/status");
  return result.ok ? { ok: true, data: { status: result.data.data, configured: result.data.configured } } : result;
}
