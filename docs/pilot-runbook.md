# Production pilot runbook

1. Confirm real login, verification, refresh, logout and current-user responses in staging.
2. Disable demo authentication and complete a real-account staging login.
3. Verify migrations, restore a production backup into an isolated database, and record restore time.
4. Send accelerated in-app and email reminders to all pilot users.
5. Refresh the same Jotform submission twice and verify one opportunity plus one intake record.
6. Test an invalid row, shared family number, repeat enquiry, and do-not-contact submission; confirm each remains actionable.
7. Run simultaneous claim requests and verify exactly one succeeds.
8. Schedule, reschedule, and cancel an audit; verify one Google event and the correct next-working-day sales call.
9. Send every approved purchase-link type and confirm a review date is mandatory.
10. Mark sold and confirm the handoff says `Awaiting Shopify link`, not payment confirmed.
11. Link one Shopify order, and void/reopen one accidental sale with an audit reason.
12. Reconcile Jotform and handoff counts daily for one week, then review overdue/no-next-action rates with the sales lead.

Rollback means restoring the website destination, retaining the CRM database for audit, and temporarily reopening the prior intake sheet. Do not delete CRM history during rollback.
