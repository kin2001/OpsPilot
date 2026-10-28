# POR-47 weekly cloud backup activation candidate

Status: local review only. No publication, cloud secrets, hosted run or email send has occurred.

This copies the existing encrypted backup process to a standard GitHub Windows runner so the laptop can be off. It backs up the dedicated OpsPilot Supabase database, Auth and Storage data plus recorded configuration/source into the existing private B2 restic repository. It does not publish the app or admit real users.

## Proposed activation

1. Obtain the owner's specific release of the publication hold for this backup package, permission to provision the dedicated credentials as protected GitHub Environment secrets, and permission for one test email. Product PR publication/merge remains a separate decision.
2. Publish `opspilot-backup.yml` as `.github/workflows/opspilot-backup.yml`; publish this directory's other reviewed files, including `manifest.json`, under `.github/opspilot-backup/`. Preserve the manifest's relative paths. Verify the final default-branch commit and published file hashes before enabling execution.
3. Create the `opspilot-backups` GitHub Environment restricted to the trusted `main` branch. Verify repository visibility, runner entitlement, environment protection and spending controls live before activation. Do not introduce paid runners, expanded credential scopes, additional projects or another account.
4. Transfer only the dedicated OpsPilot credentials through a protected, nonlogging path into environment secrets: `OPSPILOT_SUPABASE_TOKEN`, `OPSPILOT_DATABASE_PASSWORD`, `OPSPILOT_ANON_KEY`, `OPSPILOT_SERVICE_ROLE_KEY`, `OPSPILOT_B2_KEY_ID`, `OPSPILOT_B2_KEY`, `OPSPILOT_RESTIC_PASSWORD`, `OPSPILOT_SMTP_KEY`, and `OPSPILOT_ALERT_TO`. The recipient is maintained privately in the existing local recipient receipt; never put credential values into files, commands, logs or chat.
5. Set repository variable `OPSPILOT_CLOUD_ENABLED=true` only after approval. Set environment variable `OPSPILOT_APPROVED_OPERATOR_SHA` to the verified publication commit, `OPSPILOT_ALERTS_APPROVED=true`, and `OPSPILOT_TEST_ALERT_APPROVED=true` only for the authorized test. Any later default-branch commit requires exact-commit reapproval; otherwise the process stops safely.
6. Run `alert-test` once, verify receipt/delivery, then reset `OPSPILOT_TEST_ALERT_APPROVED=false`. Run one manual `backup`, independently accept encrypted readback, source boundary and retention receipts, then disable the duplicate laptop backup task and read back both schedules. Keep the laptop task active until the cloud replacement is accepted; do not overlap their executions.
7. Verify the first actual scheduled execution separately. Proposed schedule: Sunday 01:00 Asia/Manila (`0 17 * * 6` UTC). Retention remains seven daily plus four weekly snapshots; no data-pack prune. The first future calendar trigger is November 1, 2026.

## Fixed limits and remaining gates

- Dedicated B2 authorization expires November 2, 2026 at 23:35 Asia/Manila. This candidate stops at that boundary. Credential renewal requires reconnection and scope verification; no automatic extension or fallback.
- Weekly backups are the owner's temporary synthetic/no-real-user policy. Restore daily protection before private or real-user admission. A weekly interval permits up to one week of changes since the previous successful checkpoint.
- Workflow failure emails cannot detect a workflow that never starts, times out before notifying, loses email service, or fails the exact approved-commit guard. Unapproved code cannot consume SMTP credentials. B2 expiry stops backups while the unchanged approved code may still send the approved failure alert. An independent missed-run watcher remains a separate unimplemented operational gate. Hourly laptop health checks do not provide laptop-independent coverage.
- Fresh automated quota/SMTP usage, dependency health and headroom checks remain unverified. Existing dashboard observations are not automated monitoring.
- The accepted populated recovery and backend service checks remain valid for their recorded snapshots. The original full recovery elapsed time exceeded the four-hour target; this package does not demonstrate a new end-to-end recovery time or restore each new snapshot into a database.
- Local tests and independent code review establish only candidate behavior. Hosted runner paths/tools, protected-secret provisioning, actual email delivery, manual cloud execution and calendar scheduling require hosted acceptance after authorization.
- Private-user admission, product commits/pushes/PR updates/merges, Linear Done, frontend hosting and DNS changes remain held.
