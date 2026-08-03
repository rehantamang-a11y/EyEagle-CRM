# Eyeagle CRM backend scope

## Boundary

Build CRM features inside the existing Eyeagle backend and PostgreSQL database. Create only new tables with a `crm_` prefix. Reuse the existing authentication, users, roles, admin portal, database connection, deployment, logging, and notification infrastructure.

Do **not** build a new login system, user table, admin system, Shopify payment system, or operations system for CRM.

Every CRM API gets the current user from the existing backend session/JWT. Store that existing user ID in CRM records as `owner_user_id`, `created_by`, or `actor_user_id`.

## Features to build

### 1. Jotform import

Build a server-side **Refresh Jotform** API.

- Fetch submissions from the configured Jotform form with the server-held read-only key.
- Initial refresh imports all existing submissions, including historical entries.
- Later refreshes remain safe: never create a submission twice.
- Map only the required form answers: name, phone, email, location, interest, safety concerns, immediate flag, preferred callback, and form summary.
- Keep the original imported form context read-only.
- Create import issues for invalid rows, shared-phone ambiguity, and do-not-contact matches.
- If the same customer already has an open CRM opportunity, add a repeat-enquiry history event rather than creating a duplicate.

### 2. Customer and opportunity records

Create one CRM opportunity for each new enquiry.

- Customer is the long-lived contact record.
- Opportunity is one enquiry/potential sale.
- A customer can have multiple opportunities over time.
- Claiming must be atomic: only one sales person can take ownership.
- The form's preferred callback is context only; it never creates an automatic appointment or task.

Stages:

```text
New enquiry → Contacting → Audit scheduled → Awaiting purchase
                         → Snoozed
                         → Converted
                         → Not proceeding / Do not contact
```

### 3. Offline call actions and history

The CRM records what happened after a call, WhatsApp conversation, or meeting. It does not make the call.

- Contact results: reached, no answer, wrong number.
- Required comment/note.
- Conditional next step: follow up, confirm assessment later, confirmed assessment, purchase link, snooze, close, do not contact, sold, or update number.
- Save the interaction, status change, next action, and history entry in one transaction.
- Keep history append-only. Corrections add new history; they do not silently overwrite earlier notes.

### 4. Follow-ups, Due, and Upcoming

Every open/snoozed opportunity needs a future sales commitment or closure.

- Create a follow-up with an exact date and time.
- Show due/overdue work separately from future **Upcoming** work.
- Keep future follow-ups visible; they must not disappear after being scheduled.
- Allow a date to be changed with a mandatory reason/comment.
- Preserve the prior date and new date in the history.
- Snooze requires a reason and review date.
- Notify the owner for due/overdue and upcoming commitments.

### 5. Confirmed bathroom assessments

Assessment interest is not an appointment.

- Create an assessment only after sales enters date/time, duration, address, operations context, and `customerConfirmed=true`.
- Update stage to `Audit scheduled` only after confirmation.
- Create a post-assessment sales follow-up for the next working day (Monday–Saturday).
- Put Google Calendar creation/reschedule/cancel into an outbox job.
- Track separate statuses: customer confirmed, Calendar pending, synced, failed, cancelled.
- Reschedule requires customer confirmation again.

### 6. Purchase journey

- Admin manages an approved purchase-link catalog.
- Sales selects a current approved link and records how it was manually sent.
- Sending a link requires a purchase-review date.
- Opportunity becomes `Awaiting purchase` until the next decision.
- Disabled links remain visible in historical records but cannot be selected for new sends.

### 7. Close, do-not-contact, and sold

- Close lost with a required standardized reason: not interested, price, chose another option, unreachable, invalid contact, outside service area, duplicate, or other.
- Do-not-contact is customer-level and blocks future CRM outreach across all opportunities.
- Mark sold closes the sales opportunity and creates one pending order handoff.
- The handoff means `Awaiting Shopify link`; it does not mean payment is confirmed.
- An admin can void an accidental pending handoff and reopen the opportunity with a reason.

### 8. Team work and notifications

- New/unclaimed queue.
- My work: Due, Upcoming, No next action, Snoozed, Closed.
- Team queue: owner filter, overdue visibility, reassignment.
- Notifications: due, overdue, upcoming, no-next-action, repeat enquiry, and handoff/audit attention.
- Reassignment moves future work but keeps the ownership record.

## New CRM tables only

Use your existing user IDs. Do not duplicate existing user/admin tables.

| Table | Purpose |
| --- | --- |
| `crm_customers` | CRM contact details and customer-level do-not-contact flag |
| `crm_opportunities` | One enquiry/potential sale and its current state/owner/next action |
| `crm_jotform_submissions` | Imported submission ID and idempotency record |
| `crm_import_issues` | Invalid, ambiguous, or do-not-contact imports for review |
| `crm_interactions` | Offline call/message outcome and sales notes |
| `crm_activities` | Exact follow-ups, reviews, reminders, and future commitments |
| `crm_ownership_events` | Claim and reassignment history |
| `crm_audit_appointments` | Confirmed assessment records and Calendar state |
| `crm_purchase_links` | Admin-approved purchase links |
| `crm_purchase_link_sends` | Which link was sent, by whom, when, and review date |
| `crm_order_handoffs` | Sold opportunity awaiting Shopify order linkage |
| `crm_notifications` | In-app notification state for CRM users |
| `crm_audit_events` | Immutable system/business audit history |
| `crm_outbox_jobs` | Calendar/reminder jobs with retry state |

Minimum useful indexes:

```text
crm_jotform_submissions(form_id, submission_id) unique
crm_opportunities(owner_user_id, status, next_action_at)
crm_opportunities(customer_id, status)
crm_activities(opportunity_id, status, scheduled_start)
crm_notifications(user_id, status, created_at)
crm_outbox_jobs(status, run_after)
```

## CRM APIs to add to the existing backend

```text
POST  /api/v1/crm/integrations/jotform/sync

GET   /api/v1/crm/dashboard
GET   /api/v1/crm/opportunities?view=unclaimed|mine|due|upcoming|...
GET   /api/v1/crm/opportunities/:id
POST  /api/v1/crm/opportunities/:id/claim
POST  /api/v1/crm/opportunities/:id/interactions
POST  /api/v1/crm/opportunities/:id/follow-ups
POST  /api/v1/crm/opportunities/:id/snooze
POST  /api/v1/crm/opportunities/:id/close-lost
POST  /api/v1/crm/opportunities/:id/mark-sold
POST  /api/v1/crm/opportunities/:id/reopen              # admin
POST  /api/v1/crm/opportunities/:id/transfer            # lead/admin

POST  /api/v1/crm/opportunities/:id/audits
PATCH /api/v1/crm/opportunities/:id/audits/:auditId

GET   /api/v1/crm/purchase-links
POST  /api/v1/crm/purchase-links                         # admin
PATCH /api/v1/crm/purchase-links/:id                     # admin
POST  /api/v1/crm/opportunities/:id/purchase-links

GET   /api/v1/crm/order-handoffs
PATCH /api/v1/crm/order-handoffs/:id/link                # admin/operations
POST  /api/v1/crm/order-handoffs/:id/void                # admin

GET   /api/v1/crm/notifications
PATCH /api/v1/crm/notifications/:id/read
```

The exact request bodies are in [backend-curl-guide.md](backend-curl-guide.md). Keep those flows, but mount them under the existing backend's CRM route group and existing authentication middleware.

## Build order

1. Add the CRM migrations/tables and reuse the existing user ID/role middleware.
2. Build Jotform full import plus idempotency and import issues.
3. Build opportunity list/detail, atomic claim, interaction history, follow-ups, Due, and Upcoming.
4. Add snooze, close, do-not-contact, reassignment, notifications, and dashboard queries.
5. Add assessment/calendar outbox and purchase links.
6. Add sold/order handoff and Shopify-link confirmation.
7. Connect the existing frontend to these APIs and remove demo data in production.

## Explicitly out of scope for this CRM backend

- Login, registration, password reset, staff/user administration
- Main admin dashboard features
- Shopify checkout/payment processing
- Performing the assessment or operations workflow itself
- Automated calling, WhatsApp, email sequences, AI scoring, or forecasting
- A configurable drag-and-drop pipeline
