# REST API contract

Base path: `/api/v1`. Successful collection responses use `{ "data": [...] }`; errors use `{ "error": { "code", "message", "fields?" } }`.

Implemented foundation routes:

- `POST /auth/login`, `POST /auth/logout`, `GET /auth/session`
- `GET|POST /leads`, `GET /leads/:id`
- `POST /leads/:id/claim|release|transfer`
- `POST /activities`, `POST /activities/:id/complete`
- `GET /dashboard/today`, `GET /dashboard/team`, `GET /pipeline`
- `GET /notifications`, `PATCH /notifications/:id/read`
- `POST /intake/website`
- `POST /intake/jotform/refresh`, `GET /intake/jotform/held`, `GET /intake/jotform/status` — admin only

The verification route is deliberately launch-gated until the real Eyeagle identity payload is confirmed. Stage transitions, close/reopen, reschedule/cancel, admin configuration and availability routes retain schema and UI extension points for the next production-connected slice.

## Intake signature

Headers:

```text
Content-Type: application/json
Idempotency-Key: <website submission id>
X-Eyeagle-Timestamp: <unix seconds>
X-Eyeagle-Signature: sha256=<hex HMAC SHA-256>
```

The signing value is `<timestamp>.<exact request body>` using `WEBSITE_INTAKE_SECRET`.

## Jotform intake (system-guide.md §1)

`POST /intake/jotform/refresh` is a manual, admin-triggered pull — no webhook, no
background poller. Each call pages through Jotform's submissions API for
`JOTFORM_FORM_ID` and ingests any submission not already present in
`jotform_submissions`. Safe to call repeatedly: correctness comes from the
unique `jotform_submission_id`, not from perfect incremental fetching, so an
overlapping or re-run refresh only ever skips duplicates.

Fields are matched by question label text, not Jotform's internal field IDs.
A submission missing a name or phone is held for review (`status =
'held_for_review'`) rather than guessed at, and does not block the rest of the
batch. `GET /intake/jotform/held` lists submissions waiting on admin review.

```jsonc
// POST /intake/jotform/refresh response
{ "data": { "fetched": 12, "created": 3, "skipped": 8, "held": 1 } }
```

Returns `501 JOTFORM_NOT_CONFIGURED` if `JOTFORM_API_KEY` or `JOTFORM_FORM_ID`
is unset. `GET /intake/jotform/status` reports the last refresh's outcome.

Per system-guide.md, form context is never treated as a commitment:
"immediate concern" only raises the created opportunity's priority (no task,
no appointment, no emergency workflow), and a preferred callback day/time is
folded into the opportunity's summary as context only — nothing in this route
writes to `next_activity_at` or creates an activity.
