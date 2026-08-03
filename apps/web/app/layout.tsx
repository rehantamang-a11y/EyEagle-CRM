import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = { title: "Eyeagle CRM", description: "Customer follow-up operations" };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
