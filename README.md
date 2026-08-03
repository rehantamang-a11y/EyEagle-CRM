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
4. Create the database and run `npm run migrate --workspace=@eyeagle/crm-database`. The API and migration commands load the root `.env` automatically in local development.
5. Start the API with `npm run dev:api`, the worker with `npm run dev:worker`, and the web app with `npm run dev:web`.

The frontend contains a representative pilot dataset so the complete workflow can be reviewed before staging is connected. Set the API URL in the Vercel environment before production use.

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
- Configure the existing Eyeagle transactional email adapter.
- Enable database backups, log drains, uptime checks, and failed-reminder alerts.
- Run `npm test`, `npm run typecheck`, and `npm run build` in CI.

See [architecture.md](docs/architecture.md), [api-contract.md](docs/api-contract.md), and [pilot-runbook.md](docs/pilot-runbook.md).
