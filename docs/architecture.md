# Architecture

The CRM is intentionally separate from the internal operations dashboard. It accepts Eyeagle identity and stable external identifiers but owns its releases, navigation, operational data, and availability.

The browser never stores upstream Eyeagle tokens. The API exchanges credentials with the Eyeagle identity service, encrypts returned tokens in `crm_sessions`, and issues an opaque HTTP-only CRM cookie. API authorization is derived from the CRM membership on every request.

Business mutations use database transactions. Lead claim is a conditional update after a capacity check in the same transaction. Activities, reminder rows, lead next-action cache, ownership history, audit history, and notification intent are committed together. The worker uses row locking with `SKIP LOCKED` so multiple instances do not process the same due item.

Website intake uses an HMAC over `<unix-seconds>.<raw-body>`, a five-minute replay window, and a required `Idempotency-Key`. Matching open leads receive a timeline event instead of a duplicate opportunity.

## Trust boundaries

- Internet browser → Vercel web app
- Vercel/server app → CRM API over TLS with CORS limited to configured origins
- Website server → signed intake endpoint
- API/worker → PostgreSQL over TLS
- API → Eyeagle identity service
- Worker → Eyeagle email provider

## Initial consistency rules

- PostgreSQL is the system of record; UI caches are disposable.
- All timestamps are `timestamptz` in UTC and displayed in `Asia/Kolkata`.
- Audit events cannot be updated or deleted.
- Activity rescheduling creates a new linked record; it never rewrites historical schedule facts.
- Customer phone is indexed but not globally unique because shared family numbers are valid.
