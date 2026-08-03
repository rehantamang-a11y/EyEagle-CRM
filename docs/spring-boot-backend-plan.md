# Eyeagle CRM backend in Kotlin + Spring Boot

## Objective

Build the CRM as a new Kotlin/Spring Boot service that uses Eyeagle's existing user/admin authentication system. It should not create a second user directory, password store, or admin portal.

```text
Existing Eyeagle backend
  ├─ users, staff, roles, admin login, mobile/app identity
  └─ issues/verifies staff identity
             │
             ▼
New CRM Spring Boot service
  ├─ CRM API and workflow rules
  ├─ Jotform import
  ├─ Calendar/order handoff jobs
  └─ CRM database/schema
             │
             ▼
Existing PostgreSQL cluster
  ├─ existing Eyeagle databases/schemas
  └─ isolated eyeagle_crm database or schema
```

The CRM service owns only CRM data: opportunities, activities, history, appointments, import issues, purchase links, and handoffs. The existing platform continues to own staff identity, roles, Shopify, and operations systems.

## 1. Decide the integration boundary first

### Database

Use the existing PostgreSQL **server**, but create a dedicated `eyeagle_crm` database. If a separate database is not possible, use a dedicated `crm` schema with a dedicated database role.

Do not:

- reuse the main app's database user;
- make CRM migrations against the main admin schema;
- have CRM code write directly to main user, Shopify, or admin tables.

Create a least-privilege role:

```sql
create role eyeagle_crm_app login password '<stored-in-secret-manager>';
create database eyeagle_crm owner eyeagle_crm_app;
```

If using a shared database with a `crm` schema, grant this role access only to that schema.

### Identity and roles

The preferred integration is for the existing Eyeagle backend to issue a short-lived JWT access token (or expose an authenticated token-introspection endpoint). CRM verifies that token on every request.

CRM maps existing platform roles/groups into its own permissions:

| Existing platform role/group | CRM permission |
| --- | --- |
| Sales member | Work owned opportunities and refresh Jotform |
| Sales lead | See team work and reassign opportunities |
| Admin | Manage links, reopen work, correct handoffs |
| Operations | Read confirmed audits and order handoffs only |

Never share the main admin application's session-encryption secret or directly query its password/session tables. Token verification is the integration point.

## 2. Create the Spring Boot service

Create a new repository/module, for example `eyeagle-crm-service`.

Use Kotlin with these modules:

```text
src/main/kotlin/in/eyeagle/crm/
  config/           Security, CORS, Jackson, clock, application config
  auth/             Principal and role mapping from Eyeagle JWT
  customer/         Customer records and contact preferences
  opportunity/      Intake, claim, stages, ownership and detail view
  activity/         Follow-ups, snoozes, reminders and upcoming work
  interaction/      Offline call/WhatsApp outcome logging
  intake/jotform/   Jotform client, mapper, importer and import issues
  audit/            Confirmed assessment appointments and Calendar outbox
  purchase/         Approved purchase-link catalog and sends
  handoff/          Sold opportunity to Shopify order handoff
  notification/     In-app notifications
  outbox/           Durable background jobs and retry processing
  shared/           Exceptions, auditing, time and ID helpers
```

Recommended dependencies:

- Spring Web MVC
- Spring Validation
- Spring Security OAuth2 Resource Server (JWT validation)
- Spring Data JPA
- PostgreSQL JDBC driver
- Flyway for migrations
- Spring WebClient for Jotform, Calendar, and existing Eyeagle APIs
- Spring Actuator for health/metrics
- Testcontainers PostgreSQL for integration tests

Spring Boot publishes its system requirements; use a currently supported Java/Spring Boot combination rather than pinning this project to an old runtime. [Spring Boot requirements](https://docs.spring.io/spring-boot/system-requirements.html)

## 3. Configure environment and secrets

Put these values in the deployment secret manager, never in the mobile app, admin frontend, or Git repository:

```yaml
spring:
  datasource:
    url: jdbc:postgresql://postgres-host:5432/eyeagle_crm
    username: ${CRM_DB_USERNAME}
    password: ${CRM_DB_PASSWORD}
  flyway:
    enabled: true
  security:
    oauth2:
      resourceserver:
        jwt:
          jwk-set-uri: ${EYEAGLE_AUTH_JWKS_URL}

eyeagle:
  auth:
    issuer: ${EYEAGLE_AUTH_ISSUER}
  jotform:
    api-key: ${JOTFORM_API_KEY}
    form-id: ${JOTFORM_FORM_ID}
    base-url: https://api.jotform.com
    field-map: ${JOTFORM_FIELD_MAP_JSON}
  calendar:
    client-id: ${GOOGLE_CALENDAR_CLIENT_ID}
    client-secret: ${GOOGLE_CALENDAR_CLIENT_SECRET}
    refresh-token: ${GOOGLE_CALENDAR_REFRESH_TOKEN}
    calendar-id: ${GOOGLE_CALENDAR_ID}
```

The CRM frontend only needs the CRM API URL. It authenticates with the existing Eyeagle access token or an approved SSO session cookie.

## 4. Implement authentication before CRM mutations

1. Configure Spring Security as an OAuth2 resource server.
2. Validate issuer, audience, expiry, and signature from Eyeagle's existing JWT/JWKS endpoint.
3. Map the token's user ID, name, email, and roles into a `CrmPrincipal`.
4. Upsert a small local `crm_users` record on first access. It is a local CRM profile, not a replacement identity account.
5. Add method-level authorization:
   - sales: own opportunities;
   - lead/admin: team views and transfers;
   - admin: catalog, reopen, handoff correction;
   - operations: read-only operations endpoints.

Spring Security's JWT resource-server support is designed to validate bearer JWTs using issuer/JWK configuration. [Spring Security JWT documentation](https://docs.spring.io/spring-security/reference/servlet/oauth2/resource-server/jwt.html)

## 5. Create migrations with Flyway

Port the existing CRM migrations into Flyway files under:

```text
src/main/resources/db/migration/
  V001__initial_crm_schema.sql
  V002__sales_workflow.sql
  V003__jotform_qualification.sql
  V004__intake_commitment_separation.sql
```

Keep an immutable audit trail. Core tables are:

- `crm_users`
- `customers`
- `opportunities`
- `activities`
- `interactions`
- `opportunity_ownership_events`
- `audit_appointments`
- `purchase_links`
- `opportunity_purchase_links`
- `order_handoffs`
- `jotform_submissions` / idempotency records
- `import_issues`
- `notifications`
- `outbox_jobs`
- `audit_events`

Use UUID IDs, `timestamptz`, and indexes on Jotform submission ID, opportunity owner/status/next action, phone normalization, and pending outbox jobs. Flyway applies migrations in order and records which migrations ran. [Flyway Java API](https://documentation.red-gate.com/flyway/flyway-cli-and-api/usage/api-java)

## 6. Build the Jotform importer

Implement Jotform as a server-only service:

```kotlin
interface JotformClient {
    fun listSubmissions(formId: String, offset: Int, limit: Int): JotformPage
}
```

The sync transaction should:

1. Call Jotform with the server-held read-only API key.
2. Page through every submission (`limit=1000`, then increase offset) for the initial backfill.
3. Map only approved question IDs to CRM fields.
4. Store an idempotency key: `jotform:<formId>:<submissionId>`.
5. If already processed, skip without changing the sales action.
6. Create a customer and unclaimed opportunity for a valid unmatched submission.
7. Add a repeat-enquiry event if the same customer has an open opportunity.
8. Write ambiguous phones, invalid rows, and do-not-contact matches to `import_issues`.
9. Return `{ scanned, imported, repeated, issues, skipped }`.

Run the first sync with `includeExisting=true`; later manual refreshes can use `false`. Do not make browser JavaScript call Jotform.

## 7. Implement workflow mutations as transactions

Every endpoint that changes an opportunity must commit its related changes together. Use `@Transactional` service methods, not controller-level SQL.

Example: record a call where the customer needs a follow-up.

```text
validate ownership and role
  → write interaction
  → write future activity/reminder
  → update opportunity stage and next_action_at
  → write immutable audit event
  → commit once
```

Required workflow operations:

- claim opportunity atomically;
- log interaction plus conditional next step;
- create and change follow-ups;
- snooze with mandatory review date;
- confirm/reschedule/cancel assessment;
- create approved purchase links and record their sends;
- close lost or do-not-contact;
- mark sold and create one pending handoff;
- reopen/transfer with audit history;
- list notifications and mark them read.

Keep the API contract in [backend-curl-guide.md](backend-curl-guide.md). Port those endpoints and payloads first so the current web UI can move to the Spring backend with minimal changes.

## 8. Use an outbox for Calendar and notifications

When a confirmed assessment is created:

1. Insert `audit_appointment` and the post-audit follow-up in the same transaction.
2. Insert an `outbox_jobs` row such as `calendar.audit.upsert` in that transaction.
3. A scheduled worker claims jobs with row locking, calls Google Calendar, and records `pending`, `synced`, or `failed`.
4. Retry transient failures with exponential backoff.
5. Reuse a stable external event ID to prevent duplicate calendar appointments.

Use the same outbox pattern for email/in-app reminders and any future order integration. Do not make an external Google or Shopify call inside the HTTP database transaction.

## 9. Implement the REST API

Keep the base path `/api/v1` so the current frontend and cURL guide remain useful.

Priority endpoint order:

1. `POST /integrations/jotform/sync`
2. `GET /opportunities?view=unclaimed|mine|due|...`
3. `GET /opportunities/{id}`
4. `POST /opportunities/{id}/claim`
5. `POST /opportunities/{id}/interactions`
6. Dedicated follow-up, snooze, close, and sold actions
7. Purchase links
8. Assessment scheduling and Calendar jobs
9. Order handoffs
10. Notifications and team/admin views

Use request DTOs with Bean Validation and return a consistent error shape:

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Some fields need attention.",
    "fields": { "nextStep.scheduledStart": ["must be a future date"] }
  }
}
```

Use `WebClient` for the external calls; Spring documents the synchronous and reactive REST client options. [Spring REST client reference](https://docs.spring.io/spring-framework/reference/integration/rest-clients.html)

## 10. Connect the existing frontend

1. Set `NEXT_PUBLIC_CRM_API_URL` to the Spring Boot service URL.
2. Replace demo data with `GET /opportunities` calls.
3. Send `credentials: "include"` for same-site session-cookie SSO, or attach a short-lived bearer token if the existing platform uses JWTs.
4. On **Refresh Jotform**, call `POST /integrations/jotform/sync` then reload opportunities.
5. Make **Upcoming** a filtered `mine` view where `nextActionAt > now`.
6. Show API validation errors inline; never silently fall back to demo data in production.

## 11. Test before connecting production data

Use Testcontainers PostgreSQL for the service's integration tests and mock Jotform/Calendar HTTP responses.

Mandatory tests:

- same Jotform submission imported twice creates one opportunity;
- 1,000+ submission pagination imports all pages;
- invalid/ambiguous submission becomes an import issue;
- two simultaneous claims allow only one owner;
- interaction and next activity roll back together on failure;
- future follow-up appears in Upcoming and remains owned;
- assessment fails without `customerConfirmed=true`;
- assessment creates one Calendar outbox job and one post-audit follow-up;
- do-not-contact blocks all future outreach;
- sold creates one pending order handoff, not a payment-confirmed order;
- user token role restrictions are enforced.

## 12. Safe rollout

1. Build and deploy the Spring Boot service to staging.
2. Point it at a separate staging CRM database.
3. Integrate staging with existing Eyeagle login/JWT verification.
4. Run a full Jotform backfill in staging and reconcile counts.
5. Have two sales members and one admin test the cURL acceptance paths.
6. Create production CRM database/schema and least-privilege role.
7. Run Flyway production migrations.
8. Deploy the service with `ALLOW_DEMO_AUTH` removed/disabled.
9. Run one controlled production Jotform backfill.
10. Turn on the frontend Refresh button and monitor import issues/outbox failures.

Rollback means routing the frontend back to the existing intake process while retaining the CRM database and audit history. Do not delete imported CRM records during rollback.

## Questions for the existing Eyeagle backend team

Before coding authentication, get these concrete answers:

1. Does the existing system issue JWTs? What are its issuer, audience, JWKS URL, and role claims?
2. If it does not, is there a secure `/me` or token-introspection endpoint that CRM can call?
3. What roles/groups should map to sales member, sales lead, admin, and operations?
4. Can the CRM use a separate database on the existing PostgreSQL cluster, or must it use a restricted schema?
5. What is the approved production CRM domain and CORS origin?
6. How should a confirmed Shopify order be exposed to CRM/operations: link only, webhook, or internal API?
