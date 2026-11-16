import { submissionDateKeyIst } from "@/lib/format-submission-date";
import type { Opportunity } from "./opportunities.types";
import { getSubmittedFormValue, NOT_ANSWERED } from "./opportunity-form";
import { isOpportunityClosed, normalizeOpportunityStatus, opportunityStatusLabel, opportunityWorkGroup } from "./opportunity-status";

const DAY = 86_400_000;
const ACTIVE_STATUSES = new Set(["OPEN", "DUE", "FOLLOW_UP", "FOLLOW_UPS", "ACTIVE"]);

type Count = { label: string; count: number };
type OwnerWorkload = { name: string; active: number; due: number; overdue: number; sold: number; notProceeding: number };
type ScheduledAction = { id: string; name: string; owner: string; label?: string | null; at: number };

function countLabels(groups: Iterable<string[]>, missingLabel?: string): Count[] {
  const counts = new Map<string, Count>();
  for (const labels of groups) {
    const seen = new Set<string>();
    for (const rawLabel of labels.length || !missingLabel ? labels : [missingLabel]) {
      const label = rawLabel.trim().replace(/\s+/g, " ");
      const key = label.toLowerCase();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      const entry = counts.get(key) ?? { label, count: 0 };
      entry.count += 1;
      counts.set(key, entry);
    }
  }
  return [...counts.values()].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

function labels(value?: string | string[] | null) {
  const values = Array.isArray(value) ? value : [value ?? ""];
  return values.map((label) => label.trim()).filter((label) => label && label !== NOT_ANSWERED);
}

function dateOnly(date: number) {
  return new Date(date).toISOString().slice(0, 10);
}

function recentEnquiries(intake: Opportunity[], now: Date) {
  const today = submissionDateKeyIst(now.toISOString())!;
  const todayUtc = Date.parse(today);
  const buckets = Array.from({ length: 8 }, (_, index) => ({
    from: dateOnly(todayUtc - (55 - index * 7) * DAY),
    to: dateOnly(todayUtc - (49 - index * 7) * DAY),
    count: 0,
  }));
  let olderThanWeek = 0;
  let unknownDate = 0;
  for (const row of intake) {
    const date = submissionDateKeyIst(row.submittedAt);
    if (!date || date > today) {
      unknownDate++;
      continue;
    }
    if (date < buckets[7].from) olderThanWeek++;
    const bucket = buckets.find(({ from, to }) => date >= from && date <= to);
    if (bucket) bucket.count++;
  }
  return { buckets, olderThanWeek, unknownDate };
}

function summarizePipeline(rows: Iterable<Opportunity>, now: Date, intakeIds?: ReadonlyMap<string, Opportunity>) {
  const tomorrow = new Date(now);
  tomorrow.setHours(24, 0, 0, 0);
  const owners = new Map<string, OwnerWorkload>();
  const stageLabels: string[][] = [];
  const attention: ScheduledAction[] = [];
  const scheduled: ScheduledAction[] = [];
  let total = 0;
  let newEnquiries = 0;
  let active = 0;
  let inactive = 0;
  let sold = 0;
  let notProceeding = 0;
  let followUps = 0;
  let due = 0;
  let overdue = 0;
  let dueToday = 0;
  let upcoming = 0;
  let unscheduled = 0;
  let activeUnassigned = 0;
  let otherStatus = 0;

  for (const row of rows) {
    total++;
    const status = normalizeOpportunityStatus(row.status);
    if (intakeIds?.has(row.id) || status === "UNCLAIMED") {
      newEnquiries++;
      stageLabels.push(["Unclaimed"]);
      continue;
    }
    stageLabels.push([status === "FOLLOW_UPS" ? "Follow-up" : opportunityStatusLabel(status)]);
    const ownerName = row.ownerName?.trim();
    const ownerKey = ownerName || "";
    const owner = owners.get(ownerKey) ?? {
      name: ownerName || "Owner not recorded", active: 0, due: 0, overdue: 0, sold: 0, notProceeding: 0,
    };
    owners.set(ownerKey, owner);

    if (isOpportunityClosed(status) || status === "INACTIVE") {
      inactive++;
      if (status === "SOLD") {
        sold++;
        owner.sold++;
      }
      if (status === "NOT_PROCEEDING") {
        notProceeding++;
        owner.notProceeding++;
      }
      continue;
    }
    if (!ACTIVE_STATUSES.has(status)) {
      otherStatus++;
      continue;
    }

    active++;
    owner.active++;
    if (!ownerName) activeUnassigned++;
    const group = opportunityWorkGroup(status);
    if (group === "DUE") {
      due++;
      owner.due++;
    }
    if (group === "FOLLOW_UPS") followUps++;

    // Match the sales queue's handling of zone-less follow-up times as local time.
    const at = row.nextActionAt ? Date.parse(row.nextActionAt) : Number.NaN;
    if (!Number.isFinite(at)) {
      unscheduled++;
      continue;
    }
    const nextAction = { id: row.id, name: row.fullName, owner: owner.name, label: row.nextActionLabel, at };
    if (at < now.getTime()) {
      overdue++;
      owner.overdue++;
      attention.push(nextAction);
    } else {
      scheduled.push(nextAction);
      if (at < tomorrow.getTime()) dueToday++;
      else upcoming++;
    }
  }

  return {
    total, active, inactive, newEnquiries, sold, notProceeding, followUps, due, overdue, dueToday, upcoming,
    unscheduled, activeUnassigned, otherStatus,
    closedOther: inactive - sold - notProceeding,
    closeRate: sold + notProceeding ? sold / (sold + notProceeding) : null,
    stages: countLabels(stageLabels),
    owners: [...owners.values()].filter((owner) => owner.active || owner.sold || owner.notProceeding)
      .sort((a, b) => b.active - a.active || b.overdue - a.overdue || b.sold - a.sold || a.name.localeCompare(b.name)),
    attention: attention.sort((a, b) => a.at - b.at).slice(0, 5),
    scheduled: scheduled.sort((a, b) => a.at - b.at).slice(0, 5),
  };
}

export function buildMyWorkDashboard(opportunities: Opportunity[], now: Date) {
  return summarizePipeline(new Map(opportunities.map((row) => [row.id, row])).values(), now);
}

export function buildSalesDashboard(sales: Opportunity[], unclaimed: Opportunity[], now: Date) {
  const intakeById = new Map(unclaimed.map((row) => [row.id, row]));
  const allById = new Map(intakeById);

  for (const row of sales) {
    const intake = intakeById.get(row.id);
    const status = normalizeOpportunityStatus(row.status);
    // Sales may also return the intake row and has the current working status after ownership.
    if (intake && (status === "UNCLAIMED" || (status === "OPEN" && !row.ownerName?.trim()))) continue;
    intakeById.delete(row.id);
    allById.set(row.id, row);
  }

  const intake = [...intakeById.values()];
  const topics = intake.map((row) => {
    const answer = getSubmittedFormValue(row.formAnswers, "interestedIn") ?? row.interest;
    // The website sends "General enquiry" as a default alongside the topics actually selected.
    return labels(answer).filter((label) => label.toLowerCase() !== "general enquiry");
  });

  return {
    ...summarizePipeline(allById.values(), now, intakeById),
    intakeCount: intake.length,
    interested: topics.filter((entry) => entry.length).length,
    topics: countLabels(topics),
    concerns: countLabels(intake.map((row) => labels(getSubmittedFormValue(row.formAnswers, "safetyConcern")))),
    sources: countLabels(intake.map((row) => labels(row.source)), "Source not recorded"),
    locations: countLabels(intake.map((row) => labels(row.location)), "Location not recorded"),
    intakeAge: recentEnquiries(intake, now),
  };
}
