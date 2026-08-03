"use client";

import { useState } from "react";
import { RefreshCw } from "lucide-react";
import { syncJotform, type JotformSyncResult } from "@/lib/api";

export function SettingsScreen({ onSave }: { onSave: () => void }) {
  return <div className="settings-layout"><aside><button className="selected">Working hours</button><button>Reminder defaults</button><button>Ownership rules</button><button>Team access</button><button>Lead sources</button></aside><section><div className="settings-heading"><div><h2>Working hours</h2><p>Scheduling outside these windows shows a warning.</p></div><button className="primary" onClick={onSave}>Save changes</button></div><label>Organization timezone<select defaultValue="Asia/Kolkata"><option>Asia/Kolkata</option></select></label><div className="setting-rule"><div><strong>Monday – Saturday</strong><span>Two available calling windows</span></div><div className="time-fields"><input defaultValue="10:00" /><span>to</span><input defaultValue="13:00" /><input defaultValue="14:00" /><span>to</span><input defaultValue="18:30" /></div></div><div className="setting-rule"><div><strong>Call buffer</strong><span>Spacing between scheduled customer calls</span></div><select defaultValue="5"><option value="5">5 minutes</option><option value="10">10 minutes</option></select></div><div className="setting-rule"><div><strong>Meeting and visit buffer</strong><span>Preparation and travel time</span></div><select defaultValue="15"><option value="15">15 minutes</option><option value="30">30 minutes</option></select></div><JotformSyncPanel /></section></div>;
}

function JotformSyncPanel() {
  const [state, setState] = useState<
    { phase: "idle" } | { phase: "syncing" } | { phase: "done"; result: JotformSyncResult } | { phase: "error"; message: string }
  >({ phase: "idle" });

  const run = async () => {
    setState({ phase: "syncing" });
    const result = await syncJotform();
    setState(result.ok ? { phase: "done", result: result.data } : { phase: "error", message: result.error.message });
  };

  return (
    <div className="setting-rule">
      <div>
        <strong>Jotform intake</strong>
        <span>Pull new submissions from the EyEagle Home Safety Interest Form.</span>
        {state.phase === "done" && (
          <p className="jotform-sync-result">
            Fetched {state.result.fetched}, created {state.result.created}, skipped {state.result.skipped}
            {state.result.rejected.length > 0 && `, ${state.result.rejected.length} rejected`}.
          </p>
        )}
        {state.phase === "error" && <p className="jotform-sync-error">{state.message}</p>}
      </div>
      <button className="secondary" onClick={run} disabled={state.phase === "syncing"}>
        <RefreshCw size={16} className={state.phase === "syncing" ? "spin" : ""} />
        {state.phase === "syncing" ? "Syncing…" : "Sync now"}
      </button>
    </div>
  );
}

// Exported for a later status-badge use (e.g. "last synced 4m ago" next to the button).
export { jotformSyncStatus };
