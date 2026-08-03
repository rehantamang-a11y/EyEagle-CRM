# Eyeagle CRM

Standalone, list-first sales workspace for the Eyeagle team. It manually imports allowlisted Jotform enquiries, guides sales through calls/audits/purchase follow-ups, and creates a pending order handoff after a sale without claiming Shopify payment is confirmed.

## Repository layout

```text
apps/web       Next.js operator workspace
apps/api       Fastify REST API and secure identity bridge
apps/worker    Reminder, overdue, and escalation worker
packages/shared    Zod schemas and shared business rules
packages/database  PostgreSQL migration runner and SQL migrations
```

## Local setup

1. Install Node.js 20+ and PostgreSQL 15+.
2. Copy `.env.example` to `.env` and provide local secrets.
3. Run `npm install`.
4. Create the database and run `npm run migrate --workspace=@eyeagle/crm-database`. The API and migration commands load the root `.env` automatically in local development.
5. Start the API with `npm run dev:api`, the worker with `npm run dev:worker`, and the web app with `npm run dev:web`.

The frontend contains a representative pilot dataset so the complete workflow can be reviewed without credentials. The API and worker require PostgreSQL. Set `NEXT_PUBLIC_CRM_API_URL` before connecting the UI to staging.

## Integration setup

Jotform is deliberately pull-only in V1. Create a read-only key, allowlist one form with `JOTFORM_FORM_ID`, and map stable question IDs in `JOTFORM_FIELD_MAP_JSON`. A sales member triggers `POST /api/v1/integrations/jotform/sync`; repeated refreshes are safe. Invalid, ambiguous, and do-not-contact submissions become `import_issues` for admin review.

For audits, use a dedicated Google Workspace integration account with Calendar-only OAuth access. Put its client secret and refresh token in the deployment secret manager, not source control. `GOOGLE_CALENDAR_ID` is the shared operations calendar. Calendar work is written to the `jobs` outbox transactionally and processed with retries by `apps/worker`.

Admins create approved purchase links through `POST /api/v1/purchase-links`. Sales can only select active catalog entries; disabling one does not alter historical sends.

## Production topology

- Vercel: `apps/web`
- Managed web service: `apps/api`
- Managed background worker: `apps/worker`
- Managed PostgreSQL: shared by the API and worker, with pooled connections and point-in-time recovery

Run migrations as a release step before deploying the API. Never run the worker against a database whose migration release is behind the worker release.

## Production gates

- Replace demo authentication by setting `ALLOW_DEMO_AUTH=false` and complete the real verification/refresh contract.
- Configure a 32+ character session secret and encryption key in the secret manager.
- Verify the website webhook signature with the exact raw request body at the edge/proxy.
- Configure the Jotform read-only key and validate the question-ID mapping against a real submission.
- Configure the dedicated Google Calendar integration account and shared operations calendar.
- Seed the approved purchase-link catalog.
- Configure the existing Eyeagle transactional email adapter.
- Enable database backups, log drains, uptime checks, and failed-reminder alerts.
- Run `npm test`, `npm run typecheck`, and `npm run build` in CI.

See [crm-backend-scope.md](docs/crm-backend-scope.md) for the CRM-only backend scope, [spring-boot-backend-plan.md](docs/spring-boot-backend-plan.md) for Kotlin/Spring Boot implementation detail, [backend-curl-guide.md](docs/backend-curl-guide.md) for copy-paste backend requests, plus [architecture.md](docs/architecture.md), [api-contract.md](docs/api-contract.md), and [pilot-runbook.md](docs/pilot-runbook.md).
