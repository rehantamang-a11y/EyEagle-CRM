import path from "node:path";
import type { NextConfig } from "next";
const config: NextConfig = {
  transpilePackages: ["@eyeagle/crm-shared"],
  outputFileTracingRoot: path.resolve(process.cwd(), "../.."),
};
export default config;
