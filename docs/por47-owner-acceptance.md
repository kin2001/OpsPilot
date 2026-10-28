# POR-47 owner acceptance and recovery target

On October 28, 2026, the owner instructed: "the recovery is change to 1 week update it also make it por 47 done". This approves a recovery-time objective of at most one week: 168 elapsed hours, or 604,800 seconds. It replaces the four-working-hour recovery target for the current delivery; it does not change backup frequency. Original approved specification/plan bytes and historical test receipts retain their recorded targets and outcomes.

POR-47 is closed by owner acceptance for the current no-real-user testing scope. PR #19 delivered the backend source and private-evidence metadata correction at main commit `11bc4126c3051301664c6b0ab0971cf936139054`; independent source review, the owner's manual acceptance and the required full CI passed. PR #20 published the protected weekly cloud-backup workflow, and PR #21 supplied its reviewed certificate-path correction.

The independently accepted populated database/Auth/Storage and recovered backend-service evidence recorded 24,081.917789 seconds (about 6 hours 41 minutes) for the original end-to-end rehearsal, including the stopped interval. That recorded duration is within the revised one-week target for the tested backend scope. The historical four-hour result remains not demonstrated. This is a policy reassessment of existing evidence, not a new restore, a guarantee, or full frontend/private-pilot acceptance.

## Deferred controls

- Cloud execution remains disabled. The corrected hosted preflight, confirmed alert delivery and one independently accepted manual cloud backup remain unfinished; laptop-independent backup protection is not established.
- Independent missed-backup alerts, fresh automated quota/dependency monitoring and an actual weekly calendar-run observation remain unfinished.
- The laptop's Sunday 01:00 Asia/Manila weekly backup remains the accepted testing configuration. Retention stays seven daily plus four weekly copies with no data-pack prune. Weekly frequency can leave up to one week of changes since the previous successful checkpoint.
- Dedicated B2 access expires November 2, 2026 at 23:35 Asia/Manila. Renewal needs dedicated-account reconnection and scope verification; no automatic extension or account fallback is approved.

These items are explicitly deferred under the owner's current testing-phase closure. They remain prerequisites to assess before private-user admission. Closure does not deploy anything, enable email/AI, change MFA or tenant permissions, purchase resources, or open private intake. The RPO/backup-age and intake guards retain their existing daily-admission thresholds; only the recovery-time assertion changes to one week.
