import { RefreshCw } from "lucide-react";

export function CrmLoading({ label = "Loading workspace" }: { label?: string }) {
  return <section className="workspace"><div className="desk-empty"><RefreshCw className="spin" size={27} /><strong>{label}</strong></div></section>;
}
