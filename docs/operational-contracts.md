# OpsPilot P1 operational contracts

These contracts are the POR-24 backend candidate. Local source checks and isolated service verification are separate; no hosted migration, private-data admission or operational safety acceptance is implied.

## Commands and compatibility

All writes use `ctx = {organization_id, request_id, expected_version?}` and the existing `{data,version,request_id}` envelope/domain codes. The organization selects context; current active relational membership authorizes it. Retry an uncertain write with the original identity and unchanged payload. A changed payload under that identity conflicts. Authorization, required AAL2 and current performer exclusions run before replay. Successful replay does not repeat events, notes, notifications or stock/physical activity.

The additive migration preserves the applied T1 migration. T1 `save_asset`, `create_work_order`, `assign_work_order` and `convert_request` return frozen explicit legacy projections. Old committed receipt shapes remain accepted by unchanged strict T1 clients. New schemas are exported from `src/contracts/operational.ts`. Native database types must be generated from the migrated isolated database; do not hand-edit them.

Existing and new mutation paths retain organization serialization, then acquire the asset and relevant work orders in ascending UUID order. Membership is checked after the tenant lock. This is a correctness guard at the approved pilot scale, not a claim of isolation from host credentials or other privileged processes.

| Command | Rule |
| --- | --- |
| `add_work_order_task(ctx,id,label,required)` | Coordinator; at most 100 tasks, before submission; changes material repair revision. |
| `update_work_order(ctx,id,allowed_fields)` | Expected WO version. Assigned technicians can record note, labor minutes and task completion only during `in_progress`. Coordinator administrative fields are title, description, category, priority, priority reason, due time and active same-tenant supervisor. Canceled/archived records cannot be edited. |
| `transition_work_order(ctx,id,target,reason?)` | Approved lifecycle. Technicians start/block/submit assigned jobs; coordinators accept/schedule/resume/cancel/reopen. Block/resume/cancel/reopen require reason. Required tasks and configured evidence must be present before submission. |
| `review_work_order(ctx,id,decision,reason)` | AAL2 coordinator who never participated in this job; current submitted material revision required. `returned` resumes repair; `approved` completes work only. |
| `set_asset_hold(ctx,asset_id,reason)` | Coordinator, expected asset version; recorded manual hold makes asset unavailable. |
| `resolve_asset_hold(ctx,hold_id,disposition,reason)` | Coordinator, expected asset version. Only explicit disposition; active repairs cannot be bypassed. Completed-job holds clear through release. Canceled-job holds require explicit disposition. |
| `release_asset(ctx,asset_id,acknowledgment)` | AAL2 nonparticipant coordinator, expected asset version, active asset, no active blocking repair/unresolved non-job hold, current material reviews. Records acknowledgment and checked hold IDs separately, then makes asset Operational. |
| `record_meter_reading(ctx,asset_id,kind,value,observed_at)` | Coordinator; `hours`/`distance`, nonnegative numeric reading. |
| `correct_meter_reading(ctx,id,value,reason)` | Appends a linked correction retaining original reading/time/kind; never updates the old reading. |
| `save_organization_settings(ctx,fields)` | Owner+AAL2, expected settings version; bounded evidence requirement/timezone/currency. AI remains disabled. Company-specific evidence policy is a private-pilot human gate. |
| `get_team(organization_id)` | Coordinator-only bounded roster, IDs/roles/active/version; no Auth directory dump. |
| `get_dashboard(organization_id,range)` | Coordinator-only server metrics; tenant-local date `from` inclusive/`to` exclusive, 1–366 days; last seven daily snapshots, truthful history completeness. |
| `mark_notifications_read(ctx,ids)` | At most 100 IDs, current tenant and recipient only. No other recipient's state changes. |

`version` changes for aggregate concurrency. Notes/labor/task execution, task definition, completion evidence and requested-work title/description change `repair_revision`; submission pins it and review records it. Requested-work title/description edits are restricted to draft/open/scheduled/in-progress. Priority/due/supervisor/category edits preserve the material revision. Administrative before/submitted values are retained in immutable work events. Reopening preserves old reviews and invalidates their applicability. Current/former assignees, execution actors, evidence uploaders and submitters remain immutable participants. Assignment is deliberately conservative; software cannot discover unrecorded physical performers.

Critical priority requires a recorded reason. Existing create/convert JSON fields accept `critical_reason`; the coordinator edit uses `priority_reason`. Existing old receipt replay remains possible without inventing a retrospective reason. The frontend must collect the reason for new Critical selections.

## Availability

### Performer declarations and submission completeness

`declare_work_order_performers(ctx,id,user_ids)` requires a current coordinator or currently assigned technician, an active asset, `in_progress` work and expected WO version. It accepts 1–30 distinct active same-tenant confirmed human user IDs, capped at 30 cumulative declarations. Each new declaration retains actor/request/time/revision and adds immutable participant disqualification. Declarations are cumulative; assignment/action facts remain disqualifying even when omitted from a declaration. Later user deactivation preserves historical attribution but prevents new declarations of that user. Reusing the same command identity returns its original result; changed payload conflicts.

Every declaration command advances concurrency and material repair revision. `submit_work_order(ctx,id,acknowledgment)` requires a nonempty cumulative declaration list including the submitter and a bounded explicit acknowledgment that every performer was declared. It records the exact cumulative IDs, actor, request and current material revision in an immutable attestation before the ordinary task/evidence checks and state transition, atomically. The old generic transition to `awaiting_review` cannot bypass the acknowledgment. Subsequent material edits make earlier attestations inapplicable; correction/resubmission records a fresh acknowledgment. Database guards reject awaiting-review/completed work without a matching revision attestation. These are accountable human declarations, not software inference of physical activity.

### Scoped asset history and strict read models

`get_asset_history(organization_id,asset_id,cursor?)` returns `{items,next_cursor}` with at most 50 facts ordered descending by `(occurred_at,id)`; the cursor is `{at,id}`. Owners/managers/supervisors see projected WO events, completion reviews, asset availability transitions and separate releases. Technicians need existing `known_asset` context and see events/reviews only for jobs they can currently read; they do not gain organization-wide or unrelated asset/job history. Wrong-tenant/revoked membership denies access. The projection exposes fixed operational fields, not unrestricted audit changes, Auth profiles, credentials or membership administration. Direct owner-only audit permissions remain unchanged.

Shared strict schemas now cover dashboard counts/trends, bounded history/cursor, tasks, events, reviews, recipient notifications, declarations and submission attestations. The frontend must validate actual RPC/row results with these schemas, preserve null unknown/no-data values, and use generated native types from the actual migrated CI artifact. New schema/service checks remain unverified until CI; current T1 browser checks do not establish the new T2 interface journey.

Active legacy/new assets begin Out of Service with explicit availability-unverified provenance. This does not assert a discovered physical defect. The first truthful event is recorded now; no old interval, physical finding or historical release is fabricated. Archived assets are inactive. Reactivation is conservative and requires release again.

Manual unresolved holds take precedence over repair states. Active repair implies Under Maintenance; accepted blockers imply Out of Service; completed job holds imply Pending Release. Completion never makes the asset Operational. Canceling a never-accepted draft creates no hold and does not invalidate a previous release. Canceling accepted work keeps its hold. A new blocking job, reopening, or new hold serializes against release and invalidates availability. Release participant scope follows unreleased source-linked holds, including dispositioned holds awaiting the separate release, rather than a lifetime ban.

Availability events are immutable audit facts. Metrics reconstruct nonoverlapping asset intervals from ordered events and clip to the half-open range. History before the first event is unknown; the dashboard reports incomplete history and nullable unknown daily availability. Its figures are lab-testable definitions, not field availability evidence.

## Private image lifecycle

JPEG/PNG/WebP only, 5 MiB/file, at most 10 pending+ready files/parent, initial tenant admission cap 250 MiB. Pending reservations count toward quota until reconciled. PDF and other document types remain disabled pending the approved safe-document/malware process.

`POST attachment-upload` accepts `{ctx,id,name,media_type,size}` for an in-progress WO, or `{ctx,parent_type:'asset'|'request',parent_id,name,media_type,size}`. Asset writes require coordinator authority; request evidence writes require the reporter or coordinator while draft/returned. Parents have composite tenant foreign keys and exactly one parent is required. Ready reads follow current parent authorization.

Reservation returns a random private object reference. `PUT ?organization_id=...&attachment_id=...` sends the exact bounded bytes with the declared media type. The Edge validates current JWT/user/parent, extension/media consistency, magic/structure/dimensions, size and SHA-256; writes with `upsert:false` and `cacheControl:'0'`; and calls a service-only finalizer. Finalization rechecks current membership, role/assignment and parent state under locks before setting ready. WO evidence increments material revision and records participation. Retrying uncertain storage success compares existing bytes before finalizing the same reservation. A ready replay compares checksum without replacing bytes.

`GET` at that same reference reauthorizes, then downloads using the current user's JWT and Storage ready-parent RLS. Edge responses use `private,no-store`, restrictive content headers and attachment disposition. Direct client Storage writes are denied. No public/signed bearer URLs are produced. Provider cache headers are not asserted beyond actual observations. Pixel must use no-store authenticated fetch behavior, temporary Blob URLs and revoke them on record/org/user/logout changes; displaying images requires narrowly allowing `blob:` in CSP `img-src`.

The bounded orphan reconciler claims pending/rejected rows older than 24 hours as rejected under tenant locks **before** deleting bytes. A finalizer cannot concurrently turn a claimed orphan ready. Failed removal/acknowledgment remains durable and retryable. Ready evidence is never selected. The library is invoked only by the positively guarded recovery rehearsal; it has no standalone destructive CLI or new automation schedule. Private operations scheduling remains a separately authorized admission concern.
