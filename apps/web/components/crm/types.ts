export type CRMView = "today" | "unclaimed" | "mine" | "customers" | "pipeline" | "team" | "settings";

export const viewTitle: Record<CRMView, { eyebrow: string; title: string; description: string }> = {
  today: { eyebrow: "Sunday, 2 August", title: "Today", description: "Your follow-ups, exceptions and next actions in one place." },
  unclaimed: { eyebrow: "Shared queue", title: "Unclaimed leads", description: "Oldest and highest-priority enquiries appear first." },
  mine: { eyebrow: "Personal book", title: "My leads", description: "Every active conversation you currently own." },
  customers: { eyebrow: "Customer records", title: "Customers", description: "Search the complete history of people and enquiries." },
  pipeline: { eyebrow: "Sales progress", title: "Pipeline", description: "A stage-by-stage view of every open opportunity." },
  team: { eyebrow: "Management", title: "Team overview", description: "Workload, overdue follow-ups and leads needing attention." },
  settings: { eyebrow: "Workspace", title: "Settings", description: "Control availability, reminders and ownership limits." },
};
