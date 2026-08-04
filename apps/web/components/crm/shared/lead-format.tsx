import type { Lead } from "@/lib/demo-data";

export function Stage({ name }: { name: string }) {
  return <span className="stage">{name}</span>;
}

export function Priority({ priority }: { priority: Lead["priority"] }) {
  return <span className={`priority ${priority}`}><i />{priority}</span>;
}

export const initials = (name: string) => name
  .replace(/^(Mrs\.|Mr\.|Dr\.|Colonel)\s+/i, "")
  .split(" ").slice(0, 2).map((part) => part[0]).join("");

export const time = (iso: string) => new Intl.DateTimeFormat("en-IN", {
  hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata",
}).format(new Date(iso));

export const day = (iso: string) => new Intl.DateTimeFormat("en-IN", {
  day: "numeric", month: "short", timeZone: "Asia/Kolkata",
}).format(new Date(iso));

export const age = (iso: string) => {
  const minutes = Math.max(1, Math.round((Date.now() - new Date(iso).getTime()) / 60_000));
  if (minutes < 60) return `${minutes} min`;
  if (minutes < 1440) return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
  return `${Math.floor(minutes / 1440)}d`;
};

export const minutesUntil = (iso: string) => Math.max(0, Math.round((new Date(iso).getTime() - Date.now()) / 60_000));
