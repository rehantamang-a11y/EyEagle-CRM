import type { NextConfig } from "next";
import { APP_BASE_PATH } from "./lib/app-path";

const configuredBackendUrl = process.env.CRM_BACKEND_URL;

if (!configuredBackendUrl) {
  throw new Error("CRM_BACKEND_URL is required for the Next.js API proxy.");
}

const proxyBackendUrl = configuredBackendUrl.replace(/\/+$/, "");

const config: NextConfig = {
  basePath: APP_BASE_PATH,
  async rewrites() {
    return [{ source: "/api/backend/:path*", destination: `${proxyBackendUrl}/:path*` }];
  },
};

export default config;
