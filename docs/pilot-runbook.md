# Production pilot runbook

1. Confirm real login, verification, refresh, logout and current-user responses in staging.
2. Disable demo authentication and complete a real-account staging login.
3. Verify migrations, restore a production backup into an isolated database, and record restore time.
4. Send accelerated in-app and email reminders to all pilot users.
5. Send the same signed website submission twice and verify one lead plus one intake record.
6. Run simultaneous claim requests and verify exactly one succeeds.
7. Manually enter active Excel leads with their owner, stage and next action.
8. Route new website enquiries to CRM and reconcile submissions daily for one week.
9. Make the spreadsheet read-only after reconciliation passes.
10. Review no-next-action percentage, reminder failures, overdue count and team feedback after two weeks.

Rollback means restoring the website destination, retaining the CRM database for audit, and temporarily reopening the prior intake sheet. Do not delete CRM history during rollback.
