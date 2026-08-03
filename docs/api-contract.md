# REST API contract

Base path: `/api/v1`. Successful collection responses use `{ "data": [...] }`; errors use `{ "error": { "code", "message", "fields?" } }`.

## Routes

**Identity**

- `POST /auth/login`, `POST /auth/logout`, `GET /auth/session`, `POST /auth/verify`
- `PATCH /me/reminder-channels`

**Leads**

- `GET /leads` — cursor paginated (`limit`, `cursor`), plus `scope`, `q`, `stage`, `includeClosed`
- `POST /leads`, `GET /leads/:id`, `GET /leads/:id/activities`
- `POST /leads/:id/claim | release | transfer`
- `POST /leads/:id/stage` — move within the open pipeline
- `POST /leads/:id/close | reopen` — won/lost capture with a close reason
- `POST /leads/:id/notes`

**Customers**

- `PATCH /customers/:id`
- `POST /customers/:id/do-not-contact`

**Activities**

- `POST /activities`, `POST /activities/:id/complete | reschedule | cancel`

**Read models**

- `GET /dashboard/today`, `GET /dashboard/team`, `GET /pipeline`, `GET /pipeline-stages`, `GET /team`
- `GET /notifications`, `PATCH /notifications/:id/read`, `POST /notifications/read-all`

**Intake and operations**

- `POST /intake/website`
- `POST /intake/jotform/sync`, `GET /intake/jotform/status` — admin only
- `GET /health` (liveness), `GET /ready` (checks the database)

## Completing an activity

Completion is the moment the follow-up chain is kept or broken, so the request
must resolve it. `next` is required and discriminates the body:

```jsonc
{
  "outcome": "connected",          // closed enum, see activityOutcomes
  "notes": "Spoke to the daughter.",
  "nextStageId": "<uuid>",         // optional, open stages only

  // exactly one of:
  "next": "schedule", "followUp": { "type": "call", "title": "…", "scheduledStart": "…", "durationMinutes": 15, "reminderMinutes": [1440, 30] }
  // "next": "close", "closeStatus": "won" | "lost", "closeReason": "won_installed" | "lost_price" | …
  // "next": "none",  "noNextActionReason": "at least ten characters"
}
```

`next: "none"` is recorded against the operator who chose it and suppresses the
inactivity nag; it is a deliberate, attributable decision rather than a default.

## Scheduling constraints

Conflicts use a buffer derived from the activity type — 15 minutes for meetings,
home visits and bathroom audits, 5 minutes otherwise. An admin may override a hard
conflict with `overrideConflictReason`, which is written to the audit trail.

Organization calling windows and the customer's preferred contact hours are soft
constraints: scheduling outside them returns `422 OUTSIDE_CALLING_WINDOW` unless
`overrideWindowReason` is supplied, in which case the response carries `warnings`.

## Duplicate phone numbers

Families share numbers, so a match is not automatically a duplicate:

- an **open** lead on that number → `409 DUPLICATE_OPEN_LEAD`
- a known customer with **no** open lead → `409 EXISTING_CUSTOMER` with
  `acknowledgeAs`; resubmit with `acknowledgedDuplicateCustomerId` to attach a new
  enquiry to that customer rather than forking the record.

## Concurrency

`stage`, `close`, `reopen` and `PATCH /customers/:id` accept `expectedVersion`.
A mismatch returns `409 STALE_VERSION`. Omit it to opt out.

## Intake signature

Headers:

```text
Content-Type: application/json
Idempotency-Key: <website submission id>
X-Eyeagle-Timestamp: <unix seconds>
X-Eyeagle-Signature: sha256=<hex HMAC SHA-256>
```

The signing value is `<timestamp>.<exact request body>` using `WEBSITE_INTAKE_SECRET`.
Replays return `200` with the stored result; new submissions return `202`. A
submission for a customer marked do-not-contact is recorded and suppressed rather
than queued.

## Jotform sync

`POST /intake/jotform/sync` is a manual, admin-triggered pull — not a webhook and
not a background poller. Each call pages through Jotform's submissions API for
`JOTFORM_FORM_ID` and ingests any submission not already recorded in
`jotform_submissions`. Safe to call repeatedly: correctness comes from the unique
`jotform_submission_id`, not from perfect incremental fetching, so an overlapping
or re-run sync only ever skips duplicates rather than creating them.

Form fields are matched by question label text (not Jotform's internal field
IDs), since that only needed the form as built, not live API access. Required
fields are name and phone; a submission missing either is recorded as
`rejected_missing_required_field` rather than guessed. Any expected optional
question that can't be matched (e.g. after the form is edited) is reported back
in the response's `mappingWarnings` instead of failing the sync.

```jsonc
// POST /intake/jotform/sync response
{ "data": { "fetched": 12, "created": 3, "skipped": 9, "rejected": [], "mappingWarnings": [] } }
```

Returns `501 JOTFORM_NOT_CONFIGURED` if `JOTFORM_API_KEY` or `JOTFORM_FORM_ID`
is unset. `GET /intake/jotform/status` reports the last sync's outcome.

## CSRF

Cookies are `SameSite=None` in production so a separately hosted frontend can reach
the API, which means SameSite no longer provides CSRF protection. Every
state-changing request must carry an `Origin` listed in `WEB_ORIGIN`. The signed
intake webhook authenticates itself and is exempt.
