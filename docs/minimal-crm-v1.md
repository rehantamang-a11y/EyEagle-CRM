# Minimal Eyeagle CRM — current V1

This is the delivery scope for the first live sales desk. It deliberately replaces the earlier pilot's broader workflow as the active product path.

## What the desk does

1. A sales member manually refreshes Jotform.
2. Every previously unseen Jotform submission creates one unclaimed opportunity.
3. A member takes ownership; it immediately appears in their Due list as `Call customer`.
4. After the offline conversation, they save one outcome:
   - `Follow up` with an exact future date/time and a call summary;
   - `Sold` with a confirmation note; or
   - `Not proceeding` with a reason and note.
5. Follow-ups stay in `Upcoming` until their scheduled time, then automatically appear in `Due`.
6. The form response and append-only history remain visible from every record.

## Deliberately not in V1

Calendar or assessment booking, product links, Shopify handoff, notifications, customer merging, reassignments, do-not-contact, automations, team management, and pipeline configuration.

Calls and any scheduling conversations happen offline. The CRM records the outcome only.

## API contract

All endpoints are authenticated through the existing Eyeagle login.

```text
POST /api/v1/crm/jotform/sync
GET  /api/v1/crm/opportunities?view=new|due|upcoming|closed
GET  /api/v1/crm/opportunities/:id
POST /api/v1/crm/opportunities/:id/claim
POST /api/v1/crm/opportunities/:id/action
```

`POST /action` accepts one of:

```json
{ "type": "follow_up", "note": "Customer asked for a call next week.", "nextActionAt": "2026-08-10T09:30:00.000Z" }
```

```json
{ "type": "sold", "note": "Customer confirmed the purchase offline." }
```

```json
{ "type": "not_proceeding", "note": "They have chosen another option.", "lostReason": "Chose another option" }
```

## Data and safety rules

- The four V1 tables are `crm_opportunities`, `crm_jotform_submissions`, `crm_history`, and `crm_import_issues`.
- Jotform idempotency is the exact `(form_id, submission_id)` pair. No customer matching happens in V1.
- Invalid submissions make an import issue without preventing other rows from importing.
- Claiming is a conditional update: two people cannot own the same new enquiry.
- Only the owner can save an action on an open opportunity.
- Each mutation and its history entry are stored in the same database transaction.
- Jotform credentials and field mapping are server-side environment values only.
