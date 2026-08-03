# REST API contract

Base path: `/api/v1`. Successful collection responses use `{ "data": [...] }`; errors use `{ "error": { "code", "message", "fields?" } }`.

## Sales desk

- `GET /dashboard/sales` — eight top-level operational counts.
- `GET /opportunities?view=...` — action views: `unclaimed`, `mine`, `due`, `overdue`, `no_next_action`, `audits`, `awaiting_purchase`, `snoozed`, `handoffs`, and `closed`.
- `GET /opportunities/:id` — customer/opportunity facts and immutable timeline.
- `POST /opportunities/:id/claim` — capacity checked, atomic ownership assignment. It does not place a call or create a callback activity; contact happens outside Eyeagle.
- `POST /opportunities/:id/interactions` — atomically records `channel`, `contactResult`, `notes`, and a discriminated `nextStep`. Contact result and sales decision are intentionally separate.
- `POST /opportunities/:id/follow-ups` — creates an owned activity and reminder.
- `POST /opportunities/:id/audits` and `PATCH /opportunities/:id/audits/:auditId` — schedule, reschedule, or cancel an audit and its post-audit action. Creation and rescheduling require `customerConfirmed: true`.
- `POST /opportunities/:id/purchase-links` — records an approved link send and mandatory review date.
- `POST /opportunities/:id/snooze` — mandatory review date and reason.
- `POST /opportunities/:id/close-lost` — required predefined reason; optional customer-level do-not-contact.
- `POST /opportunities/:id/mark-sold` — closes sales and creates one pending handoff.
- `POST /opportunities/:id/reopen` — admin-only, with reason and next action.
- `POST /opportunities/:id/transfer` — moves future work while preserving ownership history.

## Integrations and handoff

- `POST /integrations/jotform/sync` — authenticated manual pull from the single allowlisted form.
- `GET|POST /purchase-links`, `PATCH /purchase-links/:id` — approved catalog; mutations are admin-only.
- `GET /order-handoffs` — pending and historical sales-to-operations handoffs.
- `PATCH /order-handoffs/:id/link` — admin confirms the Shopify order reference.
- `POST /order-handoffs/:id/void` — admin voids an accidental pre-link handoff; reopening remains a separate audited action.

Legacy `/leads`, `/activities`, dashboard, notification, and signed website-intake routes remain available for compatibility while clients move to the opportunity contract.

## Jotform behavior

The API fetches submissions with the server-held `APIKEY` header and stores only mapped CRM fields. `expressedInterest` is immutable form context; callback day and period remain preferences and never populate `next_activity_at`. `jotform:<form-id>:<submission-id>` is the idempotency key. Valid rows continue even if another row fails. Import problems are recorded without exposing credentials or full raw form payloads.

## Calendar behavior

Audit mutations write `calendar.audit.upsert` or `calendar.audit.cancel` jobs in the same database transaction. The worker uses a stable Google event ID, exponential retry, and explicit `pending`, `synced`, `failed`, or `cancelled` state. No customer attendee is created in V1.
