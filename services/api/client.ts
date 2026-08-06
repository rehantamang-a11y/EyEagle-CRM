import { API_BASE_URL } from "./config";
import JSONBig from "json-bigint";

const losslessJson = JSONBig({
  storeAsString: true,
  protoAction: "error",
  constructorAction: "error",
});

type ApiErrorBody = {
  error?: { code?: string; message?: string; title?: string; fields?: Record<string, string[]>; errors?: Record<string, string[]> };
  message?: string;
};

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code = "REQUEST_FAILED",
    public readonly fields?: Record<string, string[]>,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

let accessToken: string | null = null;

export function setApiAccessToken(token?: string | null) {
  accessToken = token || null;
}

export function parseApiJson(value: string): unknown {
  return losslessJson.parse(value);
}

type ApiRequestOptions = Omit<RequestInit, "body"> & {
  body?: unknown;
  skipAuthEvent?: boolean;
};

function isAbsoluteUrl(value: string) {
  return /^https?:\/\//i.test(value);
}

export async function apiRequest<T>(path: string, options: ApiRequestOptions = {}): Promise<T> {
  const { body: requestBody, skipAuthEvent, ...requestInit } = options;
  const headers = new Headers(options.headers);
  const hasBody = requestBody !== undefined;
  if (hasBody && !headers.has("content-type")) headers.set("content-type", "application/json");
  if (accessToken && !headers.has("authorization")) headers.set("authorization", `Bearer ${accessToken}`);

  const response = await fetch(isAbsoluteUrl(path) ? path : `${API_BASE_URL}${path.startsWith("/") ? path : `/${path}`}`, {
    ...requestInit,
    body: hasBody ? JSON.stringify(requestBody) : undefined,
    credentials: "include",
    headers,
  });

  const contentType = response.headers.get("content-type") || "";
  const payload = response.status === 204
    ? undefined
    : contentType.includes("application/json")
      ? await response.text().then(parseApiJson).catch(() => undefined)
      : await response.text().catch(() => undefined);

  if (!response.ok) {
    const body = (payload && typeof payload === "object" ? payload : {}) as ApiErrorBody;
    if (response.status === 401 && !skipAuthEvent && typeof window !== "undefined") {
      window.dispatchEvent(new Event("eyeagle:auth-expired"));
    }
    throw new ApiError(
      body.error?.message || body.error?.title || body.message || (response.status === 401 ? "Your session has expired. Sign in again." : "The request could not be completed."),
      response.status,
      body.error?.code,
      body.error?.fields || body.error?.errors,
    );
  }

  return payload as T;
}
