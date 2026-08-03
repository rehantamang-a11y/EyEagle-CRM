# Eyeagle CRM

Standalone customer follow-up workspace for the Eyeagle team. This repository contains the web application, REST API, PostgreSQL migrations, shared validation contracts, and reminder worker.

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
4. Create the database and run `npm run migrate --workspace=@eyeagle/crm-database`.
5. Start the API with `npm run dev:api`, the worker with `npm run dev:worker`, and the web app with `npm run dev:web`.

The frontend contains a representative pilot dataset so the complete workflow can be reviewed before staging is connected. Set the API URL in the Vercel environment before production use.

## Production topology

- Vercel: `apps/web`
- Managed web service: `apps/api`
- Managed background worker: `apps/worker`
- Managed PostgreSQL: shared by the API and worker, with pooled connections and point-in-time recovery

Run migrations as a release step before deploying the API. Never run the worker against a database whose migration release is behind the worker release.

Build `@eyeagle/crm-shared` before the API, worker or web app: they import it from
`dist`, and on Node 20 an unbuilt package fails to resolve at runtime.

## Production gates

Enforced at boot — the API refuses to start otherwise:

- `ALLOW_DEMO_AUTH` must be false when `NODE_ENV=production`. Demo auth accepts any
  password for any `@eyeagle.in` address and grants admin by email prefix.
- `SESSION_SECRET` and `SESSION_ENCRYPTION_KEY` must each be 32+ characters.
- `WEB_ORIGIN` must list at least one origin; it is both the CORS allowlist and the
  CSRF Origin allowlist.
- `WEBSITE_INTAKE_SECRET` and `EYEAGLE_AUTH_BASE_URL` must be set.

Still manual:

- Complete the real verification/refresh contract against the Eyeagle identity service.
- Set `COOKIE_SAMESITE=none` and `COOKIE_SECURE=true` if the web app is on a
  different host than the API, or proxy the API under the web app's own domain.
- Configure the existing Eyeagle transactional email adapter.
- Enable database backups, log drains, uptime checks, and failed-reminder alerts.
  Point health checks at `/api/v1/ready`, not `/api/v1/health`.
- Agree a retention and erasure policy: `audit_events` is immutable by trigger, so
  the erasure path has to be designed rather than improvised.

CI runs tests, typecheck, per-workspace builds, migrations against PostgreSQL 15,
and `npm audit`.

See [architecture.md](docs/architecture.md), [api-contract.md](docs/api-contract.md), and [pilot-runbook.md](docs/pilot-runbook.md).
