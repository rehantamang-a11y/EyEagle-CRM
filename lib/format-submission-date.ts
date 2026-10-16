const HAS_TIME_ZONE = /(?:Z|[+-]\d{2}:?\d{2})$/i;

function parseBackendTimestamp(value: string): Date {
  const timestamp = value.trim();
  return new Date(HAS_TIME_ZONE.test(timestamp) ? timestamp : `${timestamp}Z`);
}

export function submissionDateKeyIst(value?: string | null): string | null {
  if (!value) return null;
  const date = parseBackendTimestamp(value);
  if (Number.isNaN(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: "Asia/Kolkata",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map(({ type, value: part }) => [type, part]));
  return `${values.year}-${values.month}-${values.day}`;
}

export function formatSubmissionDateUtc(value?: string | null): string {
  if (!value) return "Time not provided";
  const date = parseBackendTimestamp(value);
  if (Number.isNaN(date.getTime())) return "Time not provided";

  return new Intl.DateTimeFormat("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    timeZone: "UTC",
  }).format(date);
}

/** @deprecated Use formatSubmissionDateUtc for opportunity list timestamps. */
export const formatSubmissionDateIst = formatSubmissionDateUtc;
