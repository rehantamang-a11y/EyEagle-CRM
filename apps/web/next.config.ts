import path from "node:path";
import type { NextConfig } from "next";

const isLocalEnvironment = process.env.NEXT_PUBLIC_APP_ENV === "local";
const localBackendUrl = (process.env.CRM_BACKEND_URL || "https://dev02.eyeagle.ai/api/v1").replace(/\/+$/, "");

const config: NextConfig = {
  outputFileTracingRoot: path.resolve(process.cwd(), "../.."),
  async rewrites() {
    if (!isLocalEnvironment) return [];
    return [{ source: "/api/backend/:path*", destination: `${localBackendUrl}/:path*` }];
  },
};

export default config;
