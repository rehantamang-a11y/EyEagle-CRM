"use client";

import { Button } from "@/components/ui/button";

export default function ErrorBoundary({ error, reset }: { error: Error; reset: () => void }) {
  return <section className="workspace"><div className="desk-empty"><strong>Could not open this workspace</strong><span>{error.message || "An unexpected error occurred."}</span><Button variant="outline" size="sm" onClick={reset}>Try again</Button></div></section>;
}
