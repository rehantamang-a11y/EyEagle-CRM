const configuredBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL ?? process.env.NEXT_PUBLIC_CRM_API_URL;
const isLocalEnvironment = process.env.NEXT_PUBLIC_APP_ENV === "local";

if (!isLocalEnvironment && !configuredBaseUrl) {
  throw new Error("NEXT_PUBLIC_API_BASE_URL is required outside the local environment.");
}

export const API_BASE_URL = isLocalEnvironment
  ? "/api/backend"
  : configuredBaseUrl!.replace(/\/+$/, "");
