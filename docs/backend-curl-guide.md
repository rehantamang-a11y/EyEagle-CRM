# Eyeagle CRM backend — cURL hand-off

This is the backend contract for the sales CRM. The browser should call the CRM API; it must never call Jotform or store the Jotform API key directly.

All dates use ISO 8601 UTC, for example `2026-08-10T10:30:00.000Z`.

## 1. Common setup

```bash
export CRM_API="https://crm-api.eyeagle.in/api/v1"
export COOKIE_JAR="./eyeagle-crm.cookie"
export OPPORTUNITY_ID="replace-with-opportunity-uuid"
```

All protected endpoints use the CRM's HTTP-only session cookie. The cURL examples keep that cookie in `COOKIE_JAR`.

```bash
curl -i "$CRM_API/health"

# Local demo only. In production this calls the main Eyeagle admin authentication service.
curl -c "$COOKIE_JAR" \
  -H 'content-type: application/json' \
  -d '{"email":"sales@eyeagle.in","password":"replace-me"}' \
  "$CRM_API/auth/login"

curl -b "$COOKIE_JAR" "$CRM_API/auth/session"

curl -X POST -b "$COOKIE_JAR" "$CRM_API/auth/logout"
```

For production, replace the current login bridge with the main admin login/SSO verification contract. The frontend should send requests with `credentials: "include"`; it should not receive database credentials, Jotform keys, or a long-lived API token.

## 2. Jotform import

The Jotform key and form ID are configured on the CRM API server only. This endpoint reads all submissions in pages, imports missing ones, preserves repeats as timeline events, and creates import issues for ambiguous/invalid rows.

```bash
# Full historical import — safe to run more than once.
curl -X POST -b "$COOKIE_JAR" \
  -H 'content-type: application/json' \
  -d '{"includeExisting":true}' \
  "$CRM_API/integrations/jotform/sync"

# Incremental import after the first backfill.
curl -X POST -b "$COOKIE_JAR" \
  -H 'content-type: application/json' \
  -d '{"includeExisting":false}' \
  "$CRM_API/integrations/jotform/sync"
```

The response includes `scanned`, `imported`, `repeated`, `issues`, and `lastSyncedAt`. A second full import should return `imported: 0` for already-recorded form submissions.

## 3. Read the sales desk

```bash
curl -b "$COOKIE_JAR" "$CRM_API/dashboard/sales"

curl -b "$COOKIE_JAR" "$CRM_API/opportunities?view=unclaimed"
curl -b "$COOKIE_JAR" "$CRM_API/opportunities?view=mine"
curl -b "$COOKIE_JAR" "$CRM_API/opportunities?view=due"
curl -b "$COOKIE_JAR" "$CRM_API/opportunities?view=overdue"
curl -b "$COOKIE_JAR" "$CRM_API/opportunities?view=no_next_action"
curl -b "$COOKIE_JAR" "$CRM_API/opportunities?view=snoozed"
curl -b "$COOKIE_JAR" "$CRM_API/opportunities?view=awaiting_purchase"
curl -b "$COOKIE_JAR" "$CRM_API/opportunities?view=handoffs"
curl -b "$COOKIE_JAR" "$CRM_API/opportunities?view=closed"

curl -b "$COOKIE_JAR" "$CRM_API/opportunities/$OPPORTUNITY_ID"
curl -b "$COOKIE_JAR" "$CRM_API/notifications"
```

The UI's **Upcoming** tab can be generated from the `mine` view: show active or snoozed opportunities whose `nextActionAt` is later than the current time.

## 4. Take ownership

```bash
curl -X POST -b "$COOKIE_JAR" \
  -H 'content-type: application/json' \
  -d '{}' \
  "$CRM_API/opportunities/$OPPORTUNITY_ID/claim"
```

Claiming only sets ownership. It does not falsely log a call or schedule work by itself.

## 5. Record what happened after an offline call

Use the interaction endpoint when the call/message happened outside the CRM. It atomically writes the interaction, current state, next action, activity/reminder, and audit record when applicable.

### Reached — follow up later

```bash
curl -X POST -b "$COOKIE_JAR" \
  -H 'content-type: application/json' \
  -d '{
    "channel":"call",
    "contactResult":"reached",
    "notes":"Customer asked us to call after discussing it with family.",
    "nextStep":{"type":"schedule_follow_up","title":"Customer follow-up","scheduledStart":"2026-08-10T10:30:00.000Z"}
  }' \
  "$CRM_API/opportunities/$OPPORTUNITY_ID/interactions"
```

### No answer — schedule another attempt

```bash
curl -X POST -b "$COOKIE_JAR" \
  -H 'content-type: application/json' \
  -d '{
    "channel":"call",
    "contactResult":"no_answer",
    "notes":"No answer; retry at the requested time.",
    "nextStep":{"type":"schedule_follow_up","title":"Retry call","scheduledStart":"2026-08-08T05:30:00.000Z"}
  }' \
  "$CRM_API/opportunities/$OPPORTUNITY_ID/interactions"
```

### Wrong number — update and retry

```bash
curl -X POST -b "$COOKIE_JAR" \
  -H 'content-type: application/json' \
  -d '{
    "channel":"call",
    "contactResult":"wrong_number",
    "notes":"Customer supplied a corrected number.",
    "nextStep":{"type":"update_number","phone":"+91 98765 43210","scheduledStart":"2026-08-08T05:30:00.000Z"}
  }' \
  "$CRM_API/opportunities/$OPPORTUNITY_ID/interactions"
```

### Reached — discuss a date but do not confirm an assessment yet

```bash
curl -X POST -b "$COOKIE_JAR" \
  -H 'content-type: application/json' \
  -d '{
    "channel":"call",
    "contactResult":"reached",
    "notes":"Customer needs to confirm availability with their family.",
    "nextStep":{"type":"confirm_audit_date","scheduledStart":"2026-08-09T06:00:00.000Z"}
  }' \
  "$CRM_API/opportunities/$OPPORTUNITY_ID/interactions"
```

### Reached — confirm an assessment appointment

Only use this after the customer explicitly agrees to the date and time.

```bash
curl -X POST -b "$COOKIE_JAR" \
  -H 'content-type: application/json' \
  -d '{
    "channel":"call",
    "contactResult":"reached",
    "notes":"Customer confirmed the bathroom assessment appointment.",
    "nextStep":{
      "type":"confirm_audit",
      "scheduledStart":"2026-08-12T05:30:00.000Z",
      "durationMinutes":60,
      "address":"12 Example Road, Noida",
      "context":"Son will meet the assessor.",
      "customerConfirmed":true
    }
  }' \
  "$CRM_API/opportunities/$OPPORTUNITY_ID/interactions"
```

### Reached — share an approved purchase link

```bash
export PURCHASE_LINK_ID="replace-with-approved-link-uuid"

curl -X POST -b "$COOKIE_JAR" \
  -H 'content-type: application/json' \
  -d "{\
    \"channel\":\"whatsapp\",\
    \"contactResult\":\"reached\",\
    \"notes\":\"Sent the approved safety-kit link on WhatsApp.\",\
    \"nextStep\":{\"type\":\"send_purchase_link\",\"purchaseLinkId\":\"$PURCHASE_LINK_ID\",\"channel\":\"whatsapp\",\"reviewAt\":\"2026-08-12T05:30:00.000Z\"}\
  }" \
  "$CRM_API/opportunities/$OPPORTUNITY_ID/interactions"
```

### Reached — close or mark sold

```bash
# Lost reason must be one of: not_interested, price, chose_alternative,
# unreachable, invalid_contact, outside_service_area, duplicate, other.
curl -X POST -b "$COOKIE_JAR" \
  -H 'content-type: application/json' \
  -d '{
    "channel":"call",
    "contactResult":"reached",
    "notes":"Customer chose another provider.",
    "nextStep":{"type":"not_proceeding","reason":"chose_alternative"}
  }' \
  "$CRM_API/opportunities/$OPPORTUNITY_ID/interactions"

curl -X POST -b "$COOKIE_JAR" \
  -H 'content-type: application/json' \
  -d '{
    "channel":"call",
    "contactResult":"reached",
    "notes":"Customer confirmed they want to proceed.",
    "nextStep":{"type":"mark_sold","confirmationNote":"Customer confirmed purchase; operations to link Shopify order."}
  }' \
  "$CRM_API/opportunities/$OPPORTUNITY_ID/interactions"
```

## 6. Dedicated action endpoints

These are useful where a user takes an action outside the interaction dialog.

```bash
# Schedule a follow-up.
curl -X POST -b "$COOKIE_JAR" -H 'content-type: application/json' \
  -d '{"scheduledStart":"2026-08-10T10:30:00.000Z","title":"Customer follow-up","type":"call","durationMinutes":15,"notes":"Requested a later call."}' \
  "$CRM_API/opportunities/$OPPORTUNITY_ID/follow-ups"

# Snooze, with a mandatory review date and reason.
curl -X POST -b "$COOKIE_JAR" -H 'content-type: application/json' \
  -d '{"reviewAt":"2026-08-15T05:30:00.000Z","reason":"Family is travelling; review next week."}' \
  "$CRM_API/opportunities/$OPPORTUNITY_ID/snooze"

# Close and optionally apply customer-level do-not-contact.
curl -X POST -b "$COOKIE_JAR" -H 'content-type: application/json' \
  -d '{"reason":"not_interested","note":"Customer asked not to be contacted again.","doNotContact":true}' \
  "$CRM_API/opportunities/$OPPORTUNITY_ID/close-lost"

# Mark sold. This creates a pending handoff; it does not mark Shopify payment as confirmed.
curl -X POST -b "$COOKIE_JAR" -H 'content-type: application/json' \
  -d '{"confirmationNote":"Customer confirmed the order; awaiting Shopify link."}' \
  "$CRM_API/opportunities/$OPPORTUNITY_ID/mark-sold"
```

## 7. Confirmed assessment changes

```bash
export AUDIT_ID="replace-with-audit-uuid"

# Create a confirmed appointment outside an interaction.
curl -X POST -b "$COOKIE_JAR" -H 'content-type: application/json' \
  -d '{"scheduledStart":"2026-08-12T05:30:00.000Z","durationMinutes":60,"address":"12 Example Road, Noida","context":"Son will meet the assessor.","customerConfirmed":true}' \
  "$CRM_API/opportunities/$OPPORTUNITY_ID/audits"

# Reschedule: explicit reconfirmation is required.
curl -X PATCH -b "$COOKIE_JAR" -H 'content-type: application/json' \
  -d '{"action":"reschedule","scheduledStart":"2026-08-13T05:30:00.000Z","durationMinutes":60,"reason":"Customer requested a new date.","customerConfirmed":true}' \
  "$CRM_API/opportunities/$OPPORTUNITY_ID/audits/$AUDIT_ID"

# Cancel and choose a new sales action.
curl -X PATCH -b "$COOKIE_JAR" -H 'content-type: application/json' \
  -d '{"action":"cancel","reason":"Customer cancelled the visit.","nextActionAt":"2026-08-15T05:30:00.000Z"}' \
  "$CRM_API/opportunities/$OPPORTUNITY_ID/audits/$AUDIT_ID"
```

## 8. Purchase-link catalog and sales send

These catalog mutations are admin-only.

```bash
# List active links.
curl -b "$COOKIE_JAR" "$CRM_API/purchase-links"

# Create an approved link.
curl -X POST -b "$COOKIE_JAR" -H 'content-type: application/json' \
  -d '{"name":"Essential Safety Package","url":"https://eyeagle.in/buy/essential","description":"Standard approved purchase link."}' \
  "$CRM_API/purchase-links"

# Disable a link without changing historical sends.
curl -X PATCH -b "$COOKIE_JAR" -H 'content-type: application/json' \
  -d '{"isActive":false}' \
  "$CRM_API/purchase-links/$PURCHASE_LINK_ID"

# Record a manual link send and create its review task.
curl -X POST -b "$COOKIE_JAR" -H 'content-type: application/json' \
  -d "{\"purchaseLinkId\":\"$PURCHASE_LINK_ID\",\"channel\":\"whatsapp\",\"reviewAt\":\"2026-08-12T05:30:00.000Z\",\"note\":\"Sent manually after the call.\"}" \
  "$CRM_API/opportunities/$OPPORTUNITY_ID/purchase-links"
```

## 9. Admin corrections and order handoff

```bash
export TEAM_MEMBER_ID="replace-with-new-owner-uuid"
export HANDOFF_ID="replace-with-handoff-uuid"

# Transfer future work; the ownership history is preserved.
curl -X POST -b "$COOKIE_JAR" -H 'content-type: application/json' \
  -d "{\"newOwnerUserId\":\"$TEAM_MEMBER_ID\",\"reason\":\"Annual leave\",\"note\":\"Please continue the scheduled follow-up.\"}" \
  "$CRM_API/opportunities/$OPPORTUNITY_ID/transfer"

# Admin-only reopen. A future action is required.
curl -X POST -b "$COOKIE_JAR" -H 'content-type: application/json' \
  -d '{"reason":"Customer called back and wants to discuss again.","nextActionAt":"2026-08-10T05:30:00.000Z"}' \
  "$CRM_API/opportunities/$OPPORTUNITY_ID/reopen"

curl -b "$COOKIE_JAR" "$CRM_API/order-handoffs"

# Admin links the actual Shopify order after operations confirms it.
curl -X PATCH -b "$COOKIE_JAR" -H 'content-type: application/json' \
  -d '{"shopifyOrderId":"#1234","shopifyOrderUrl":"https://admin.shopify.com/store/example/orders/1234"}' \
  "$CRM_API/order-handoffs/$HANDOFF_ID/link"

# Admin voids an accidental handoff before it is linked.
curl -X POST -b "$COOKIE_JAR" -H 'content-type: application/json' \
  -d '{"reason":"Marked sold in error before checkout."}' \
  "$CRM_API/order-handoffs/$HANDOFF_ID/void"
```

## 10. Notifications

```bash
export NOTIFICATION_ID="replace-with-notification-uuid"

curl -b "$COOKIE_JAR" "$CRM_API/notifications"
curl -X PATCH -b "$COOKIE_JAR" "$CRM_API/notifications/$NOTIFICATION_ID/read"
```

## Implementation rules

- Keep `JOTFORM_API_KEY`, `JOTFORM_FORM_ID`, Google credentials, and database credentials in the backend secret manager only.
- Run Jotform sync from the CRM API, never from browser JavaScript.
- Use the full import (`includeExisting: true`) for the initial backfill. Repeated calls are safe because every Jotform form/submission ID is idempotent.
- Use an isolated CRM database/schema and a least-privilege database user; do not let the CRM write to the main admin tables.
- Do not treat `mark-sold` as a payment confirmation. Only an operations-linked Shopify order is operationally confirmed.
- For every active or snoozed opportunity, send a future action, snooze date, confirmed assessment, purchase review, or closure in the same mutation.
