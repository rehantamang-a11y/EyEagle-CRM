import type { NextConfig } from "next";
import { APP_BASE_PATH } from "./lib/app-path";

const isLocalEnvironment = process.env.NEXT_PUBLIC_APP_ENV === "local";
const localBackendUrl = (process.env.CRM_BACKEND_URL || "https://dev02.eyeagle.ai/api/v1").replace(/\/+$/, "");

const config: NextConfig = {
  basePath: APP_BASE_PATH,
  async rewrites() {
    if (!isLocalEnvironment) return [];
    return [{ source: "/api/backend/:path*", destination: `${localBackendUrl}/:path*` }];
  },
};

export default config;
