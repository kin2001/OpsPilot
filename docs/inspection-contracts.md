# Inspection submission and private evidence

POR-32 / slice 25D provides the initial backend contract. Inspection UI and corrections follow in 25F and 25E respectively. No corrective submission command is exposed here.

## Commands and reads

All commands use the existing authenticated `{ organization_id, request_id, expected_version? }` context and `{ data, version, request_id }` envelope. Callers keep the same request ID and exact payload after uncertain acknowledgement. A different payload under that identity returns `CONFLICT`. Authorization is rechecked before replay. The database records actual actors; callers cannot supply inspector or publisher attribution.

| RPC | Contract |
| --- | --- |
| `publish_inspection_template(ctx, fields)` | Operations coordinator publishes `title` and 1–100 uniquely identified items `{ id, label, required, safety_relevant, evidence_required }`. Existing template ID requires its current version; publication adds an immutable revision. |
| `assign_inspection(ctx, asset_id, template_revision_id, inspector_id, due_on?)` | Coordinator pins an immutable assignment to an existing revision and eligible active inspector. New assignments on archived assets are denied. |
| `submit_inspection(ctx, assignment_id, template_revision_id, results)` | Only the actual assigned active eligible actor submits once. Results have unique `item_id`, `outcome: pass\|fail\|not_applicable`, `evidence_ids`, optional `reason` and `remarks`. Fail/N/A require remarks, N/A additionally requires a reason. All required items must be present; configured evidence must be ready and belong to this assignment. |
| `reserve_inspection_attachment(ctx, assignment_id, name, media_type, size)` | Assigned inspector reserves a bounded private image before submission. Use existing `uploadPrivateImage` and `downloadPrivateImage` for bytes, or the existing attachment Edge POST/PUT/GET flow with `assignment_id` reservation. |
| `list_inspection_templates(organization_id, cursor?, page_size?)` | Eligible members read template headers, ordered by UUID. |
| `list_inspection_revisions(organization_id, template_id, cursor?, page_size?)` | Eligible members read immutable published revisions, ordered by revision number. |
| `list_inspection_assignments(organization_id, cursor?, page_size?)` | Coordinators read organization assignments; technicians read only their own, ordered by UUID. |
| `get_inspection(organization_id, assignment_id)` | Returns `{ assignment, revision, submission, episodes }` with the same assignment authorization. Submission is null before first submit. |

Lists default to 25 and reject sizes outside 1–100. UUID continuation is the last returned ID, revision continuation the last returned revision; null means no further page. Shared strict Zod schemas and the typed client freeze these DTOs. Attachments add optional nullable `inspection_assignment_id` to keep existing persisted responses readable.

## Safety and authorization

Submission, first failure episode, Submitted corrective request, source-linked safety hold, audit and notification effects commit together. Each failed item creates one episode/request; only safety-relevant failures create holds. A coordinator explicitly converts each request into a work order. Submission never completes repair or releases an asset. Original labels/rules, evidence IDs, results, inspector and time remain immutable when later templates publish.

Submission uses the existing organization then asset lock order used by release. A safety failure on an already archived asset still creates a fresh unresolved hold and changes availability to Out of Service. A release racing that failure either observes the hold or precedes the failure that invalidates availability.

Inspection evidence uses the existing private repair-evidence bucket, bounded image structural validation and service-only finalization. Reservation/finalization stop after submission; all metadata, Edge and Storage reads recheck current role, membership, account and assignment. Revoked actors lose access even when retaining an old session. No signed download URL or broad asset-read permission grants inspection evidence access. Existing image and organization quotas remain intact.

Inspection hold disposition remains an explicit authorized human action. An active linked repair blocks disposition; Completed repairs require their current independent review. Release retains evidence, AAL2, blocking work and unresolved hold gates. Immutable current/former repair participants of a linked inspection remedy are excluded while its hold remains unreleased, including after disposition; prior released scope is not a lifetime ban. Software checks do not replace the approved human safety procedure.

## Upgrade, recovery and verification

Migration `20261024000300_inspections.sql` is additive, preserves old receipts and source records, and widens the attachment parent constraint. No destructive rollback is provided: preserve existing records and use a reviewed forward migration if recovery is needed. Normal database backup/restore includes revisions, assignments, submissions, episodes, request/hold links and receipts; private object bytes require the existing separate Storage recovery procedure.

`010_inspections.test.sql` covers constraints, identity, required evidence, immutability, archived assets and replay/revocation. `tests/integration/inspections.test.ts` covers real Auth/Storage/Edge denial, independent ordinary fixtures, explicit repair/review/disposition/release and both deliberate release/submission lock orders. Populated upgrade and recovery rehearsals assert durable episode/request/hold source links and receipt replay. Existing full CI remains required for native schema generation, SQL, service integration, browser regressions and recovery. Local unit/type/lint/build results alone do not establish these service checks or human security/business acceptance.
