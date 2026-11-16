# Eyeagle CRM

Frontend-only Next.js sales workspace for Eyeagle. The application uses the external CRM backend for authentication, Jotform synchronization, opportunity ownership, My Work, outcome mutations, opportunity details, and activity history.

## Repository structure

```text
app/          Next.js App Router entry points and global styles
components/   CRM screens, auth surfaces, providers, and UI primitives
contexts/     Application-wide auth and RBAC state
hooks/        TanStack Query hooks grouped by domain
lib/          Browser persistence and shared utilities
public/       Static assets
services/     API client, DTOs, adapters, and endpoint functions
docs/         Canonical frontend, authentication, and design documentation
```

## Local development

Requirements: Node.js 20.9 or newer.

```bash
npm install
cp .env.example .env.local
npm run dev
```

Local development uses the `/sales/api/backend` same-origin Next.js proxy and sends backend traffic to `https://dev02.eyeagle.ai/api/v1`. See [.env.example](.env.example) and [frontend architecture](docs/frontend-architecture.md) for development and production configuration.

## Sales dashboard

Open **Dashboard** in the CRM sidebar or visit `/sales/dashboard` after signing in. The dashboard reads All Sales and New Enquiries with the current CRM session and counts each opportunity ID once. Active counts exclude enquiries waiting for ownership. Inactive counts include sold, not proceeding, and other closed records. Win rate is sold divided by sold plus not proceeding.

Select **My work** to see your assigned pipeline, scheduled and overdue actions, and sales outcomes. This tab uses the same signed-in-user endpoint as the My Work queue.

The current All Sales response provides status, owner name, and next-action timing. The unclaimed list supplies submission dates, topics, concerns, locations, and sources, so those breakdowns describe the current intake queue. The CRM records follow-up, sold, and not proceeding as sales outcomes. Stated interest comes from the submitted enquiry topics.

## Validation

```bash
npm run typecheck
npm test
npm run build
```

## Documentation

- [Design system](docs/design-system.md)
- [Frontend architecture and API contracts](docs/frontend-architecture.md)
- [Authentication and token lifecycle](docs/authentication.md)
