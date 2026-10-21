# OpsPilot Technical Implementation Plan

> **For agentic workers:** Use the repository's spec-team workflow and its task-scoped implementation skills. Execute the approved plan task by task; checkboxes below describe planned work, not completed work. Relay coordinates sequential writers, independent Lens review, and the owner's selected phase acceptance.

Status: draft for joint package review, 2026-10-21. Review with `docs/product-spec.md`; approval applies to exact saved bytes of both documents. Execution evidence belongs in Linear and the retained run record.

**Goal:** Deliver the full V2 maintenance suite in coherent internal phases, then release the full suite as a limited real operational pilot using private data and free resources first.

**Architecture:** A responsive React application calls Supabase Auth, permission-filtered PostgreSQL reads, transactional database commands, and private Storage. A small set of Edge Functions handles privileged invitation delivery, validated file handling, and optional AI requests. Deterministic database logic owns workflow, inventory, schedules, metrics, permissions, and audit history.

**Tech stack:** React/Vite/TypeScript, Tailwind/shadcn components, React Router, TanStack Query, React Hook Form/Zod; Supabase Auth/PostgreSQL/RLS/Storage/Edge Functions/Cron; Vitest, Playwright, GitHub Actions; proposed Cloudflare Pages static hosting. No application microservices, generic SQL agent, vector database, or local AI installation is required.

**Specification:** `docs/product-spec.md`, the companion draft prepared for this package. Requirements REQ-01–REQ-16 and cases CASE-01–CASE-30 are carried below.

## Global constraints and confirmed operating model

- Full V2 is approved as planning scope: core operations, calendar preventive maintenance, inspections, inventory, in-app notifications, reports, team/settings, and AI assistance. This document does not authorize implementation.
- Internal increments use synthetic data. The first external release is the full twelve-module V2 operational pilot after combined gates pass; private business data is admitted only then. A public portfolio demonstration uses separate synthetic data and identities.
- Supervisor, manager, and owner may completion-review and separately release assets. A recorded repair performer cannot approve that repair or its operational release. An eligible completion reviewer may perform the separate release action.
- The pilot supports real operations using free resources first, with upgrades as usage grows. It is not restricted to a parallel-records evaluation. No paid upgrade is authorized; earlier capacity/privacy/reliability/recovery shortfalls require an explicit owner decision or safe intake pause.
- Real-data AI remains disabled until acceptable applicable provider terms/data handling and business consent are verified. Implement and test every AI capability synthetically meanwhile; normal manual operations remain fully usable.
- Named actual human business/safety, security/privacy, and recovery decision owners must be designated before private pilot activation. The current human product owner decides these appointments; no name or qualification is assumed.
- No Linear resources, installs, provider provisioning, Git initialization, product code, deployment, production migration, or paid resources are authorized by this draft. Environment preparation follows package approval and actual Linear task readback.

## Review focus

1. A former assignee who performed a repair remains ineligible to review/release after reassignment; concurrent repair/release actions must not bypass that rule. Pin this in T2 database integration tests.
2. A valid session, guessed UUID, forged organization ID, cached workspace result, signed file URL, or revoked membership must not expose another tenant's data. Pin database, Storage, Edge, and browser cases in T1/T2.
3. A dropped response after an inventory or workflow commit must not make a retry repeat the operation. Pin durable request identities and conflicting payload retries in T2/T4.
4. A missed PM scheduler run, DST boundary, month end, or edited template must not duplicate work or rewrite historical instructions. Pin deterministic calendar fixtures and immutable revisions in T3.
5. A restored database without its files, current access decisions, and provider configuration is not a usable private pilot. Pin an early isolated restore drill in T2 and the full-suite first-release human gate in T6.

## Existing project and stack

Verified on 2026-10-21: `docs/projectBrief.md` contains the product concept, candidate stack, workflows, security expectations, MVP, and expansion roadmap. `design-references/v2/README.md`, `manifest.json`, `prompts.md`, and the PNG set provide visual references. `.agents/skills/spec-team/` contains this workflow's templates and preparation contracts. The project root is not currently a Git repository; there is no product manifest, lockfile, migration, application source, caller, API implementation, or existing product integration to preserve.

The PNGs are illustrative desktop compositions, approximately 1672 × 941, rather than implemented behavior or a reconciled dataset. Copy, counts, contacts, and status rules must come from the approved specification and seeded fixtures. No existing implementation behavior is claimed.

Observed host: Windows 11 x64; Node 24.15.0; npm 11.12.1; Git 2.52.0.windows.1; Python 3.14.5. Docker, Supabase CLI, and GitHub CLI were not found on PATH during planning. Planning capacity is C: 3,475,857,408 bytes (~3.24 GiB) and D: 3,649,482,752 bytes (~3.40 GiB); neither is an assumed cache/Docker fallback. Recheck before installation. Provider account/project identity, authenticated Git access, SMTP configuration, available CI quota, RAM/virtualization, and a suitable isolated backend remain unverified.

**Recipe decision:** No approved verified product recipe or adequate existing product stack exists here. Evaluate the brief's proposed stack as a fresh, economical modular application. Engine/peer metadata supports a candidate version intersection; installation, build, browser, provider, and security checks must establish actual compatibility. Preserve the installed Node/npm rather than replacing global runtimes.

## Architecture, proposed files, and ownership boundaries

All paths in the following map are **proposed new product paths**, not existing files:

| Proposed path | Responsibility / initial owner |
| --- | --- |
| `package.json`, `package-lock.json`, `.npmrc`, `vite.config.ts`, `tsconfig*.json` | Pinned client/toolchain configuration; first assigned writer only |
| `src/app/` | Router, authenticated shell, workspace boundary, error/loading handling; Pixel |
| `src/components/ui/`, `src/styles/` | Selected accessible components and shared tokens; Pixel |
| `src/assets/opspilot-logo.png` | Unmodified copy of `design-references/v2/00-opspilot-logo.png` reused by desktop/mobile shells and authentication/onboarding layouts; Pixel |
| `src/features/{auth,organizations,assets,requests,work-orders}/` | Core routes, forms, queries and mutations; Pixel |
| `src/features/{maintenance,inspections,inventory,notifications,reports,assistant,team,settings}/` | Approved V2 feature modules; Pixel |
| `src/lib/supabase.ts`, `src/lib/database.types.ts`, `src/lib/domain-errors.ts` | Client setup, generated database types, narrow error adaptation; Forge then Pixel |
| `src/contracts/` | Shared Zod command/AI schemas with explicit field allowlists; Forge |
| `supabase/config.toml`, `supabase/migrations/`, `supabase/seed.sql` | Reproducible schema, permissions, jobs and synthetic seed; Forge |
| `supabase/functions/{organization-invite,attachment-upload,assistant}/` | External email/privileged file/AI boundaries only; Forge |
| `supabase/tests/database/`, `tests/integration/`, `tests/e2e/` | Real database permission/transaction tests, service and browser checks; owning implementer |
| `.github/workflows/ci.yml`, `public/_headers`, `public/_redirects` | CI and static-host security/routing configuration; assigned integration writer |
| `docs/operations.md`, `docs/security-applicability.md` | Service identity checks, recovery, pilot handoff, ASVS applicability; Forge with human input |

Keep screens and their queries/forms together by feature. Use Supabase-generated database types; Zod validates untrusted form/Edge/model inputs rather than duplicating the complete relational schema in a second ORM. Do not add a custom backend server, repository layer, event broker, or abstraction over every SDK call.

The browser holds only a publishable Supabase key and the signed-in user's session. It receives tenant-filtered data through RLS and narrow read RPCs. Sensitive commands run in one PostgreSQL transaction. Edge Functions validate the user before performing administrative Auth actions or calling external services; service credentials are restricted to the smallest required code paths. Cron executes bounded internal database routines, not browser-authenticated endpoints. Realtime is optional wake-and-refetch for the current workspace's work orders/notifications; it is not the source of truth.

## Data and API contracts

### Relational baseline

UUID primary keys, server UTC `timestamptz`, immutable creation actor/time, `version integer` on mutable aggregates, and explicit archival timestamps are standard. Every tenant-owned row carries `organization_id`. Parents expose `UNIQUE(organization_id,id)`; child composite foreign keys prevent cross-tenant references even when a privileged process bypasses RLS. Do not cascade-delete operational history when a user, member, asset, template, or part is deactivated.

| Entity / contract | Required fields and invariant | Producer / consumer |
| --- | --- | --- |
| `organizations`, `organization_members` | Name, IANA timezone, currency; member `(organization_id,user_id)` unique, one role from owner/manager/supervisor/technician/inventory, active flag. Never remove the last active owner. User profile is separate from tenant role. | Onboarding / all authorization |
| `private.pilot_onboarding_allowlist` | Server-managed verified-user/email bootstrap eligibility, allowed organization count and consumed time; not exposed through client schemas, user metadata or editable membership fields. | Authorized pilot setup / controlled organization creation |
| `organization_invitations` | Tenant, normalized email, proposed non-owner role, inviter, token hash, expiry, accepted/revoked time. Single-use opaque token; never use Auth user metadata as role authority. Ownership transfer is a distinct protected command. | Owner invite / authenticated acceptance |
| `sites`, `assets`, `asset_meter_readings` | Tenant-unique asset code, category, site, serial/registration, archive time; meter kind/value/unit and observed/recorded time. Reject negative readings; corrected readings append rather than rewrite. | Supervisors / operations |
| `maintenance_requests` | Asset, reporter, description, category, draft/submitted/returned/converted/rejected/withdrawn status, transition reason, converted work-order ID. Exactly one conversion per request. | Internal reporter / supervisor triage |
| `work_orders`, `work_order_assignments`, `work_order_tasks` | Tenant-unique human number; asset, source request/PM occurrence, title, description, priority, due time, status, `blocks_operation`, current revision. Assignments and task results preserve identity/history. | Operations / assigned technicians |
| `work_order_participants`, `work_order_events`, `work_order_reviews` | Append-only repair participation, transitions, review decision/reason, relevant work revision and actor/time. Reassignment cannot erase participation. | Command transaction / review/history |
| `asset_holds`, `asset_releases` | Hold source job/inspection/manual reason, disposition history; release records actor/time, checked asset revision, relevant job/hold IDs and acknowledgment. No generic asset status update may create operational availability. | Safety workflow / dashboard |
| `maintenance_plans`, `maintenance_occurrences` | Asset, immutable plan revision/checklist, calendar cadence, local anchor date, next due date, active flag; unique `(plan_id,scheduled_local_date)`. Occurrence owns generated WO ID. | Supervisor / bounded Cron |
| `inspection_templates`, `inspection_template_revisions`, `inspections`, `inspection_results` | Immutable published item IDs/text/revision; result pass/fail/not_applicable, required remark for fail/N/A, inspector/time. Submitted inspection is immutable; corrections supersede. | Assigned inspector / review |
| `parts`, `stock_locations`, `inventory_balances` | Tenant-unique part code; fixed unit and optional reorder threshold. Balance unique `(tenant,part,location)` with nonnegative on-hand/reserved and `reserved <= on_hand`. | Inventory / minimal job availability |
| `inventory_movements`, `work_order_parts` | Positive `numeric(14,3)` quantity, fixed unit; receipt/issue/return/adjustment with actor/reason/source/request ID. Reservation is distinct from consumption; immutable movement ledger and compensating entries. | Inventory commands / reports |
| `attachments` | Tenant, permitted parent, random object key, original display name, verified media type/size, uploader, pending/ready/rejected status; private bucket only. | Upload boundary / authorized record readers |
| `notifications` | Tenant, recipient user, event/source ID, category, safe summary, created/read time; unique event/recipient/category. No private content in cross-tenant global channels. | Domain transaction / own inbox |
| `audit_logs`, `command_receipts` | Tenant/actor/action/entity/time/request identity, allowlisted before/after changes; durable request hash and result reference. Never log passwords/tokens/raw prompts/files. | All critical commands / owner audit |
| `ai_runs` | Tenant/user, feature, provider/model actually used, prompt version, outcome, token counts when returned, source IDs, duration, confirmation linkage. No fabricated model/usage values or default raw prompt transcript retention. | Gateway / authorized usage view |
| `assistant_conversations`, `assistant_messages` | Tenant/user ownership, title, created/updated/expiry; bounded user/model text, validated source IDs, run linkage. Protected conversation content is separate from ordinary logs and immutable business audit. | Own recent-conversation list / authorized assistant |

Index tenant plus actual access paths: membership `(user_id,active)`; assets `(organization_id,code)`; work orders `(organization_id,status,due_at,id)` and `(organization_id,asset_id,created_at,id)`; assignments `(organization_id,user_id,work_order_id)`; events `(organization_id,work_order_id,created_at,id)`; notifications `(organization_id,recipient_user_id,read_at,created_at,id)`; PM due `(active,next_due_local_date,id)`; movements `(organization_id,part_id,location_id,created_at,id)`. Verify query plans on fixtures; do not create speculative indexes on every column.

### Command surface and error behavior

Expose named RPCs, not arbitrary table writes for critical records. Every command derives actor from `auth.uid()`, checks current active membership/role and object scope, validates its full field allowlist, locks aggregates in a consistent order, writes event/audit/notifications with the mutation, and either commits everything or rolls back everything. `SECURITY DEFINER` functions use an empty `search_path`, schema-qualified references, narrowly granted execution, and explicit checks; private helpers are not API-accessible. [Supabase function guidance](https://supabase.com/docs/guides/database/functions) supports this pattern.

`CommandContext = {organization_id: UUID, request_id: UUID, expected_version?: integer}`. Organization ID selects a context, never proves access. `CommandSuccess<T> = {data:T, version:integer, request_id:UUID}`. Client adaptation exposes `DomainError = {code,message,retryable,request_id?}` from a fixed code set: UNAUTHENTICATED, FORBIDDEN, NOT_FOUND, VALIDATION, CONFLICT, INVALID_TRANSITION, INSUFFICIENT_STOCK, RATE_LIMITED, DEPENDENCY_UNAVAILABLE. PostgreSQL business errors use an allowlisted exception message; do not leak SQL/table internals. Unknown failures show a safe message and correlation ID. Edge errors use 401/403/404/409/422/429/503 consistently with these domain codes.

| Named interface | Input / output and boundary |
| --- | --- |
| `create_organization(name,timezone,currency,request_id)` | Atomically creates tenant and caller's owner membership. Caller must be verified and approved in the private pilot-onboarding allowlist; no public unrestricted tenant creation or client-supplied owner ID. |
| `create_organization_invitation(ctx,email,role)` / `accept_organization_invitation(token,request_id)` | Owner creates/revokes; confirmed signed-in email must match unexpired invitation at acceptance. Return membership, never a reusable grant. |
| `save_asset(ctx,asset_id?,fields)` / `record_meter_reading(ctx,asset_id,kind,value,observed_at)` | Operations roles; cannot set operational availability or erase historical readings/holds. |
| `save_request(ctx,id?,asset_id,description,category)` / `submit_request(ctx,id)` / `withdraw_request(ctx,id,reason)` | Any internal member creates/reads own requests; reporter edits draft/returned only and may withdraw before conversion. `triage_request(ctx,id,decision,reason)` is coordinator-only; `convert_request(ctx,id,work_order_fields)` returns the same WO on duplicate conversion. |
| `create_work_order(ctx,asset_id,fields)` / `assign_work_order(ctx,id,user_ids)` | Operations roles; all assigned members active same tenant. Corrective orders default `blocks_operation=true`; changing that safety flag requires explicit audited supervisor disposition. |
| `update_work_order(ctx,id,allowed_fields)` / `transition_work_order(ctx,id,target,reason?)` | Field/status allowlist by role/state. Expected version and immutable participant rules below. Generic update cannot set completion/review/release fields. |
| `review_work_order(ctx,id,decision,reason)` / `release_asset(ctx,asset_id,acknowledgment)` | Eligible non-performer operations actor only. Distinct transactions/actions; reviewer may later release. Asset lock and release checks below. |
| `set_asset_hold(ctx,asset_id,reason)` / `resolve_asset_hold(ctx,hold_id,disposition,reason)` | Audited operational roles; explicit source-specific resolution. Generic cancel/archive cannot clear holds. |
| `save_maintenance_plan(ctx,fields)` / private `generate_due_maintenance(now)` | Operations save revisions; private bounded job makes occurrence/WO atomically and idempotently. |
| `submit_inspection(ctx,assignment_id,template_revision_id,results)` | Assigned inspector submits; the same transaction creates/links one corrective request per failed item/source and creates safety holds. Coordinator separately converts the resulting request into a WO. |
| `request_parts(ctx,work_order_id,part_id,qty)` / `reserve_parts(ctx,work_order_id,part_id,location_id,qty)` / `release_reservation(ctx,reservation_id,qty)` | Assigned technician requests quantities on `work_order_parts` without moving/reserving stock; coordinator/inventory/owner reserves under row lock. Only owner/inventory posts physical movements. |
| `receive_stock`, `issue_reserved_stock`, `return_stock`, `adjust_stock` | Context plus part/location/quantity/source; inventory or owner only. Adjustment requires reason; issue cannot exceed reserved balance; return cannot exceed net issued quantity. |
| `get_dashboard(ctx,range)` / `get_report(ctx,kind,range,cursor)` | Server-defined, permission-filtered metrics; allowed report kinds and bounded dates/results. No caller-provided SQL or group-by expression. |
| `mark_notifications_read(ctx,ids)` | Recipient only; IDs capped at 100. Mark-all uses bounded batches for caller's current tenant. |
| Edge `organization-invite`, `attachment-upload`, `assistant` | Valid user JWT, current tenant/operation authorization, input bounds, request ID. Server secrets never returned. |

Every request identity is unique for `(organization,actor,request_id)` with a canonical payload hash and command name. A matching replay returns the committed result reference; a different payload with the same key returns CONFLICT. Retain identities for operational history; ledgers, source-conversion and PM uniqueness also prevent duplicates independently. Concurrent same-key calls serialize on the receipt record. State-changing retries reuse the original identity; never create a new identity merely because a response timed out.

### Workflow and operational release

Request states: draft → submitted; coordinator returns, rejects or converts submitted requests; reporter resubmits returned or withdraws draft/submitted/returned with reason. Returned/rejected/withdrawn states preserve reasons/history; terminal records are not resurrected. Conversion updates request and creates one linked WO atomically. Work order states: `draft → open → scheduled → in_progress → awaiting_review → completed`; assigned technician or coordinator may start directly from open/scheduled. Coordinator may reschedule scheduled → open. Assigned worker/coordinator may block in_progress with reason; only coordinator resumes blocked → in_progress or scheduled. Rejection returns awaiting_review → in_progress with reason. Coordinator may cancel a nonterminal job with reason and explicit reservation/hold reconciliation. Reopening completed work returns to in_progress, preserves/supersedes prior review, creates/reopens a hold and invalidates applicable prior availability. Canceled work uses a new linked job rather than resurrection.

Technicians may start, block, update assigned work and submit for review; they cannot resume blocked work, assign, approve, release or edit administrative fields. Submission requires required tasks completed, required evidence present, declared performers recorded, and no unreconciled parts issue. Conservatively, current/former assigned repair participants and anyone recording repair notes/labor/checklist execution/completion evidence or submission are retained as participants of that WO. Reassignment/removal cannot regain completion-review eligibility. A person's unrecorded physical activity cannot be inferred by software; pilot procedures require truthful performer declarations.

All safety-relevant commands acquire the asset row lock first, then relevant work-order rows in stable ID order. Accepting a corrective order creates its conservative operational hold. Starting a repair makes asset status under_maintenance. Completion changes work status only; asset becomes pending_release when repair work is complete and holds require clearance. A failed inspection or manual hold can make an asset out_of_service immediately. Draft requests/orders do not independently claim safe availability.

Release verifies current asset revision; completed reviewed revision of every relevant repair; no active blocking job; no unresolved manual/inspection hold; and actor absent from immutable current/former assigned/logged participants of jobs and inspection remedies associated with the current unreleased hold scope since the prior release. Holds/source links/prior release records define that scope; there is no lifetime exclusion for unrelated old repairs and no extra cycle abstraction. Release records the separate human acknowledgment, closes only eligible completed-job holds, and changes active asset availability to operational atomically. Canceled work, archival, a generic status edit, or toggling `blocks_operation` cannot silently eliminate an unresolved hold. Explicit disposition has an audit trail and cannot bypass an active blocking repair. Archived assets are inactive and cannot be released. A concurrent new blocking job/reopen/inspection failure serializes and prevents or invalidates availability. The release record is a business authorization, never a safety certificate or equipment diagnosis.

### Calendar preventive maintenance and inspections

The first V2 PM implementation supports every N calendar days/weeks/months from an organization-local anchor date, with N 1–365 for days, 1–52 for weeks, 1–24 for months. Month-end is clamped to the final day of the target month while retaining the original anchor day. Plans are calendar-based, not mileage/hour-triggered. A daily internal scheduler evaluates local due dates using each tenant's IANA timezone; timestamps remain UTC. Editing timezone/plan affects future occurrences only and is audited.

For downtime, the scheduler creates one earliest ungenerated due occurrence per plan per pass, retains its actual scheduled date, and shows backlog rather than silently skipping dates or creating thousands at once. Process at most 100 plans/200 occurrences per run, use `FOR UPDATE SKIP LOCKED`, and commit each plan's occurrence and generated WO together. A unique occurrence key handles retries/races. A plan with an unfinished generated job does not spawn a second active job automatically; it exposes overdue/backlog for supervisor disposition. Completion advances the fixed calendar cadence, not a drifting completion-date cadence. Cron delay and backlog are observable; app login is not required to schedule work. [Supabase Cron](https://supabase.com/docs/guides/cron) supplies the native job mechanism; hosted extension permissions are a preparation gate.

Published inspection templates are immutable revisions. Assignments pin the revision; editing a template publishes a new revision. Submission requires every required item, valid pass/fail/N/A, remarks on failure/N/A and configured evidence. It appends a submission; correction creates a superseding submission. The submit transaction automatically creates/links one corrective maintenance request for each failed item, unique by inspection/item source; safety-relevant failures also create unresolved source-linked holds. Thus a failed result cannot be committed without its corrective request. Coordinator conversion of that request into a WO remains an explicit human decision. Corrections never erase the original defect or automatically release an asset.

### Inventory, notifications, reports and metrics

Parts have one immutable unit once movements exist. Quantities use decimal precision, never floating-point arithmetic; unit conversion, purchasing, accounting valuation and automated procurement are excluded. Optional entered unit cost uses `numeric(14,2)` and the organization's single currency; do not present estimates as accounting totals. Stock is per location, with on_hand, reserved and available = on_hand − reserved. Lock balance rows in stable part/location order for multi-line transactions. Reserve checks available; issue reduces reserved and on_hand once; reservation cancellation releases reserved only; return increases on_hand and is bounded by net job issues. Receipts/adjustments create ledger entries. Negative balances, modifying/deleting posted movements, and silent over-issue are rejected. Reconcile balance sums against ledger/reservations; discrepancy blocks affected stock operations pending human investigation. A canceled/reopened job does not automatically repeat parts consumption.

Transactions emit recipient-scoped assignment, status/review, blocked-parts, overdue and low-stock notifications. Low stock uses `available <= reorder_threshold`; only crossing into low state emits a new threshold notification until restocked above the threshold. Unique source/event/recipient keys deduplicate Cron and command retries. Read state belongs to each recipient. Email is used for identity/invitations/recovery, not an expansion to operational email/push delivery.

Server metrics use one explicit tenant-local date range converted to UTC half-open `[from,to)`, maximum 366 days. Active assets exclude archived; available assets are active with operational status and no unresolved hold. Active WOs are open/scheduled/in_progress/blocked/awaiting_review; drafts excluded. Blocked is current blocked; pending approvals is current awaiting_review; overdue is nonterminal accepted WO with due_at < server now. Completed count is current completed WOs whose latest approved completion timestamp falls in range; historical completion-event totals, if shown, have a distinct label. Reopened work is not counted as currently completed. Completion duration is latest approved completion minus initial open time and includes blocked time; display sample size and no-data rather than zero for missing data. PM on-time rate is completed generated occurrences by scheduled due date / due eligible occurrences, excluding explicitly canceled occurrence reasons from both denominator and numerator. Downtime is the union of unavailable asset intervals, not the sum of overlapping work-order durations. Recurring faults group recorded asset/category counts; they do not claim diagnosis. Workload counts assigned active jobs, not employee productivity scores.

Availability history comes from immutable `audit_logs` events `asset.availability_changed`, emitted in the same transaction as asset creation/status/hold/release changes with asset ID, prior/new status, active flag, source hold/release IDs and server time. Order by `(occurred_at,id)` and use the next event boundary to reconstruct intervals; clip/union them to the selected report range and mark incomplete history unknown. This same source drives daily availability trends, including the dashboard's seven-day chart. Do not infer old availability from today's status or sum concurrent jobs. A tenant/asset/time filtered index supports this explicit event path; no separate analytics store is introduced.

Reports expose work orders, asset availability/downtime, PM compliance, technician assignments, parts consumption and entered maintenance-cost estimates. CSV export uses the same permission-filtered definitions, explicit timezone/currency/date range and generated timestamp; neutralize spreadsheet formula prefixes. Interactive pages cap 100 rows, defaults 25, using stable cursor ordering; exports cap 10,000 rows and require narrower filters beyond that. No unbounded browser download or service-role query bypass. Report performance and export permission checks are independently tested.

### AI contracts and privacy gate

AI features cover editable WO drafts, priority suggestions, authorized operations questions, asset maintenance history and daily prose summaries. A single gateway uses provider HTTP APIs through standard fetch; no agent framework, arbitrary SQL, unrestricted tools, autonomous approval, OCR, embeddings, image diagnosis or provider SDK is necessary for this version.

`DraftSuggestion = {schema_version:1,title,reported_problem,category,suggested_priority,reasoning_summary,asset_candidates:[{id,label}]}`. WO drafting/confirmation is available only to owner/manager/supervisor, the same actors allowed to create/update WOs manually. Technicians submit their own maintenance requests and use only permission-scoped contextual Q&A; they do not receive an unauthorized direct-WO confirmation action. Model IDs must be drawn from authorized candidate records; the server validates every reference. Omit guessed asset, priority or fact rather than inventing it. Priority is a suggestion requiring supervisor review; deterministic configured escalation rules override model priority. Draft confirmation uses the ordinary create/update command and original request identity; AI never directly writes a work order, adjusts stock, approves completion or releases equipment.

Retrieval allowlist: `blocked_work_orders`, `completed_work(range)`, `overdue_work`, `awaiting_parts`, `asset_history(asset_id,category?,range)`, `daily_metrics(range)`, and `recurring_fault_counts`. Each has fixed typed parameters, 366-day maximum range, 50 source records and 20,000 characters maximum combined text. It executes as the caller or rechecks equivalent role/resource permissions; technician access remains assigned/own scope, inventory gets only necessary parts/job context. Retrieval documents are untrusted data. Retrieved notes cannot modify tool/tenant/permission rules. Final outputs include only validated source IDs/links, distinguish database facts from generated suggestions, show retrieval time/range and acknowledge truncation or insufficient evidence. Numeric totals come exclusively from the database, never model arithmetic.

Input limit 4,000 characters; one active AI request per user; initial application caps 5 requests/user/hour and 50/organization/day; output cap 2,000 tokens; provider timeout 20 seconds with no automatic paid retry. Persist rate admission transactionally before provider call; failed/abandoned attempts count to avoid quota bypass. Quotas are application safeguards, not claims about available provider allowance. Maintain a server-side kill switch and no-cost-overage configuration; exhausted/disabled/unavailable AI returns a safe error and preserves manual inputs. Do not cache responses across tenants/users. Ordinary logs retain minimal run metadata/source IDs, not raw prompts/outputs.

Recent conversations use protected `assistant_conversations/messages`, readable/deletable only by the current active member who owns the conversation and still has the underlying feature/resource permissions. Cap 50 conversations/user and 50 messages/conversation; paginate 25 at a time. Store validated bounded prompt/answer content for 30 days from each message's creation in the synthetic demo, or in a private organization only after its AI/retention gate is approved. A daily bounded cleanup removes expired transcript rows; user deletion removes transcript content immediately from active storage. It does not erase `ai_runs` metadata or confirmed operational fields/audit. Source links recheck current access when reopened; revoked records become unavailable. Backup copies expire under the documented backup retention rather than claiming instant historical erasure. Private AI-disabled organizations cannot submit private prompts into a synthetic gateway; the synthetic demonstration is a separate environment.

**Private data gate:** Gemini unpaid terms currently allow product improvement/human review and prohibit submitting confidential/personal/sensitive information. Real pilot records must not enter that service. Synthetic demonstration prompts remain clearly synthetic; live tenant AI stays disabled until the owner-confirmed provider/data gate is satisfied. Enabling real-data AI requires current regional/contract/privacy/retention review, business authorization, named accountable human and demonstrated tenant filtering. No particular model ID or free quota is promised; pin an actually available eligible model in server configuration and record the real returned metadata. [Gemini API terms, checked 2026-10-21](https://ai.google.dev/gemini-api/terms).

## Authentication, authorization, and security

**Target:** Applicable OWASP ASVS **5.0.0 Level 2** requirements for a deployed application with accounts/private business data; stable version verified from [OWASP](https://asvs.owasp.org/) on 2026-10-21. The applicability worksheet in proposed `docs/security-applicability.md` maps versioned requirement IDs to implementation/check/evidence/exclusion. This target, agent review and scans do not establish certification.

| Role | Permitted resource/operation scope | Explicit exclusions |
| --- | --- | --- |
| Owner | Organization/membership/settings; all tenant operations/reports/audit; protected ownership transfer | Cannot review/release own performed repair; cannot bypass unresolved holds |
| Manager | Tenant assets, triage, WOs, assignment/review/release, PM/inspections, inventory read/reservation coordination, reports | No owner transfer, posted stock movement/adjustment or private provider credentials; same performer restriction |
| Supervisor | Assets, triage, WOs/assignment/review/release, PM/inspections, operational reports, parts reservations | No membership administration, stock adjustment or owner settings; same performer restriction |
| Technician | Assigned WOs/checklists/repair updates; own requests; asset context needed for those jobs; permitted evidence | No unrelated jobs/asset history, administrative assignment, approval/release, stock posting, team-wide reports |
| Inventory officer | Parts/locations/receipts/issues/returns/adjustments, stock reports; own requests and minimal linked job/asset context | No private repair narrative beyond necessity, membership settings, completion/release, general assistant retrieval |
| Platform administrator / external requester | Deferred product consoles; provider operators use separately authorized support procedures | No implicit cross-tenant application role or secret dashboard in the browser |

Read authorization uses active memberships stored in the database, not editable user metadata or stale role claims. Protect membership/permission fields from direct writes. Revoke access takes effect on subsequent database/Storage command checks; on workspace switch clear query caches/subscriptions, abort in-flight requests, and key every query by user+organization. On logout remove local authenticated data. Browser UI hiding is convenience, never authorization. [Supabase RLS guidance](https://supabase.com/docs/guides/database/postgres/row-level-security).

Use Supabase supported email/password confirmation, password reset and TOTP MFA. Proposed password policy is minimum 12 characters with long passphrases accepted. Require MFA for privileged membership/settings, completion/release, stock adjustments and bulk exports; enforce the verified `aal2` claim in relevant server boundaries rather than a UI flag. Test expiry, wrong audience/signature, revoked membership, logout and recovery. Document JWT/session revocation latency and configured token expiry; any stricter session invalidation requirement needs a verified provider mechanism before private launch.

Invitations are an application membership workflow. New users confirm their email through Auth; existing confirmed users sign in and accept the organization invitation. The token alone cannot create membership, pick a role or switch tenant. It expires after seven days, is hashed at rest, and may be revoked/resend-replaced by the owner. Acceptance rechecks inviter/organization policy and email; membership does not appear until atomic acceptance. Auth invitation is server-admin-only and rejects already confirmed users; never treat it as the complete multi-organization membership contract. [Supabase user/invitation documentation](https://supabase.com/docs/guides/auth/users).

Signup/recovery/invite email must have a verified transport before first release. Supabase's default SMTP is limited to infrastructure-team addresses, currently two messages/hour, and is unsuitable for the pilot's member invitations. Configure a suitable authorized SMTP service/domain and verified redirect allowlist; verify signup, existing-user invitation, expired invite and password recovery end to end. An existing-account/manual link flow still needs actual email ownership and a secure recovery path. Do not add pilot users to the infrastructure team to bypass SMTP limits. [Supabase SMTP documentation](https://supabase.com/docs/guides/auth/auth-smtp).

Private attachment policy: JPEG/PNG/WebP up to 5 MiB each, at most 10 ready files/record; PDF up to 5 MiB only after verified safe-download handling and approved malware review process. Disallow SVG/HTML/executables/archives and misleading extensions/content. Upload Edge validates one bounded file's magic bytes, media type, size and current parent permission, uses a reserved random object key and durable request ID, and finalizes ready metadata only after storage succeeds. Client direct Storage writes are denied; only the narrow server path writes. Parent permission and ready metadata govern list/read access. Use authenticated `storage.download` with current user JWT and RLS on every fetch, then a temporary local Blob URL for display/download; revoke Blob URLs on context clear/logout. Do not create signed/public bearer download links. Revoked members cannot fetch again or reuse a remote public URL; already downloaded bytes cannot be recalled. Disable private response caching, force document download and restrictive content headers, and display only validated images. Reconcile orphaned pending/rejected uploads after 24 hours without deleting ready evidence or uncertain committed outcomes. Bucket MIME/size limits are defense in depth, not file-content validation. [Storage limits](https://supabase.com/docs/guides/storage/uploads/file-limits).

Trust boundaries include browser/XSS/session storage, Auth identity, RLS/PostgREST/RPC, service-role Edge code, Storage objects, Cron, SMTP provider, AI provider, CI and deployment credentials. Enforce CSP, safe text rendering, no raw model HTML, fixed allowed origins/redirects, HTTPS, dependency integrity, rate limits and tenant quotas. Do not send operational data to analytics by default. Audit role changes, denied sensitive operations, review/release, inventory corrections, settings and exports without secrets. Retain operational records, ready evidence, participants, command identities and business/security audit for the pilot's duration until an explicit authorized post-pilot retention/disposition decision; no automatic destructive expiry. Conversation content expires after 30 days; pending/rejected orphan files after 24 hours; protected backups retain 7 daily and 4 weekly copies. Erasure requests use a human privacy review preserving required business history, rather than silent cascading deletion. No legal retention period is invented.

ASVS applicability covers validation/business logic, frontend/file handling, authentication/session/token management, authorization, data protection, secure communication/configuration/dependencies, and safe error/log handling. Payment processing, native apps, direct machine control and autonomous AI actuation are excluded because the product does not perform them. Relevant abuse cases are CASE-09–CASE-12, CASE-18, CASE-21, CASE-23, CASE-25–CASE-28. Qualified human security review is required before private pilot credentials/data; the designated human security owner decides findings and residual risk. Business/safety owner approves release procedures and performer policy; software does not replace inspection or qualified operational judgment.

## Development environment preparation

Follow `.agents/skills/spec-team/references/environment.md`. This planning inspection is read-only. After current package approval and real Linear issue readback, Relay assigns Forge the shared toolchain/backend preparation inside T1; Pixel owns frontend changes only after Forge's handoff. Lens checks evidence in the existing phase gate. One writer owns each `node_modules`, lockfile, local database, port and dependency directory.

**Candidate exact baseline, registry metadata checked 2026-10-21:** React 19.3.1, Vite 8.3.5, `@vitejs/plugin-react` 6.1.2, TypeScript 7.0.2, Tailwind and `@tailwindcss/vite` 4.3.3, React Router DOM 7.18.4, TanStack Query 5.104.5, React Hook Form 7.90.0, Zod 4.6.7, `@hookform/resolvers` 6.0.0, `@supabase/supabase-js` 2.118.0, Supabase CLI 2.121.0, Vitest 5.0.5, Playwright Test 1.64.1, shadcn CLI 4.22.1. Exact React DOM/type/UI-component transitive versions are resolved, peer-checked and locked in T1 before component generation. They are not described as installed or integration-verified.

Engine intersection: Vite/plugin require Node ^20.19 or >=22.12; Supabase JS >=22; Vitest supports Node ^22.12/^24/>=26; installed Node 24.15 fits these metadata constraints. Vite plugin targets Vite 8 and Tailwind plugin permits Vite 8. TypeScript/template/type compatibility is still a smoke-check gate. Official registry evidence includes [Vite8.3.5 metadata](https://registry.npmjs.org/vite/8.3.5), [React plugin6.1.2](https://registry.npmjs.org/@vitejs%2fplugin-react/6.1.2), [SupabaseJS2.118.0](https://registry.npmjs.org/@supabase%2fsupabase-js/2.118.0), [Vitest5.0.5](https://registry.npmjs.org/vitest/5.0.5) and each other named package's equivalent exact-version registry record, checked 2026-10-21; [Vite runtime guidance](https://vite.dev/guide/) independently documents its floor. No `@latest`, forced peer resolution or arbitrary global upgrade is part of the saved recipe.

Preparation commands run only in the assigned verified worktree root:

```powershell
Get-Location
git status --short
node --version
npm --version
Get-PSDrive D | Select-Object Name,Free,Used
npm config get registry
npm config get strict-ssl
npm cache verify
```

Expected: intended checkout/branch with preserved user files, Node 24.15.0/npm 11.12.1, approved HTTPS npm registry and TLS integrity enabled, enough free disk for the measured dependency/browser budget. Initial planning free space is insufficient to promise Docker readiness. Require at least 8 GiB free for frontend, browser binaries and working allowance before local install; a Docker stack needs a separately verified larger budget and virtualization capacity. This is a project preparation threshold, not a provider hardware specification.

Create the minimal approved manifests/configs directly rather than running an unpinned scaffold over this populated directory. Set `packageManager: npm@11.12.1`, exact direct dependency versions, engine constraint supporting Node 24.15, and project `.npmrc` with `save-exact=true`, `engine-strict=true`, `strict-peer-deps=true`. First resolution uses `npm install --ignore-scripts`; retain and review `package-lock.json`. Subsequent reproducible installs use `npm ci --ignore-scripts`. `npm ci` removes existing node_modules and rejects inconsistent locks; it is not a presence check. Preserve locks and diagnose mismatches without deletion/forced flags. [npm ci semantics](https://docs.npmjs.com/cli/v11/commands/npm-ci/).

Install policy: official HTTPS npm registry packages and pinned official component sources only. Inspect the resolved lifecycle hooks before any execution. Native optional binary packages must resolve for Windows x64/Linux x64 as applicable. No install-time hook is approved by default; the only contingent allowed rebuild is a resolved `esbuild` postinstall after inspecting its pinned source and demonstrating it is needed, using `npm rebuild esbuild --foreground-scripts`. Unexpected hooks or other required scripts block dependent installation until narrowly reviewed within this recipe or materially revised. Do not use `--force`, `--legacy-peer-deps`, disabled TLS, global script permissions or `dangerously-allow-all-scripts`. Installed npm returned undefined for the newer documented script-allowlist configuration fields, so this plan does not rely on them. Explicit Playwright browser installation is reviewed as a separate expected binary download.

Proposed package scripts, implemented in T1: `dev = vite --host 127.0.0.1`; `build = tsc -b && vite build`; `preview = vite preview --host 127.0.0.1`; `typecheck = tsc -b --pretty false`; `test = vitest run`; `test:integration = vitest run --config vitest.integration.config.ts`; `test:e2e = playwright test`; `lint = eslint .`; `db:test = supabase test db`; `db:reset = supabase db reset --local`. Lock compatible ESLint/type/component dependencies during T1; do not silently omit linting because no manifest existed at planning time.

```powershell
npm ls --depth=0
npm exec --no -- vite --version
npm exec --no -- supabase --version
npm exec --no -- playwright --version
npm exec --no -- playwright install chromium
npm run typecheck
npm run lint
npm test
npm run build
```

Expected: exact selected resolved versions, no missing/invalid dependencies, an actual browser executable, passing meaningful initial tests/build, and public bundle containing no server credentials. Review package audit findings and actual dependency provenance; do not claim an audit command proves security.

**Backend validation route:** Current Windows host lacks Docker and has constrained disk. Use a selected Linux GitHub Actions runner with an isolated Supabase Docker stack for full Auth/Postgres/Storage/RPC integration; pin the CLI, runner/runtime and action commit revisions during T1, expose only loopback test services, and run `npm exec --no -- supabase start`, `npm exec --no -- supabase db reset --local`, `npm run db:test`, `npm run test:integration`, and browser journey tests. Filter/suppress CLI credential output at collection; local generated keys still do not belong in reports. Stop only the job-owned stack at teardown. This route requires actual repository/CI access and sufficient quota before it can be called available. Plain unit mocks or an embedded PostgreSQL library do not substitute for RLS/Auth/Storage integration evidence.

Local frontend work may use mocks until an authorized isolated development backend exists; it cannot pass live integration acceptance on mocks. A dedicated hosted synthetic development/test project is an alternative only after its account/project/environment and provisioning authorization are verified. Hosted Edge/test deployments require that explicit target; no production or third-party load test is implied. Do not install Docker Desktop, enable virtualization, relocate global runtimes or provision paid resources automatically. If neither isolated route is available, backend-dependent work/acceptance remains blocked.

Service identity check before each write: provider account, organization, project ID, environment and permission scope; Git remote/repository/branch protection; SMTP domain/sender; AI project/billing/privacy setting if enabled. Reuse valid native/connector sessions. Supabase CLI `login` uses native credential storage but documents plaintext fallback; if fallback occurs, stop credential persistence until safe supported storage or an explicit owner decision exists. Do not pass secrets in command arguments. [Supabase CLI credential behavior](https://supabase.com/docs/reference/cli/supabase-login).

Only `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` are public client configuration. Server variable names include `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, `GEMINI_API_KEY`, `AI_MODEL`, `AI_ENABLED` and provider-specific SMTP credentials; use supported provider secret settings and OS-backed CLI sessions. If local function secrets are needed, use ignored/untracked user-restricted `supabase/.env.local`; client development uses ignored `.env.local` containing public values only. Verify exact paths with `git check-ignore -v` and `git ls-files` before writing; inspect build, deployment/container/archive exclusions separately. Commit `.env.example` with empty/fake values only. No copied browser cookies, token files, credentials in receipts, or secret-file hashes.

On partial install: preserve lock/user files and sanitized failure evidence; check disk/network/locked processes/OS/native resolution; retry only after diagnosis. Do not promise rollback of arbitrary scripts. Reuse healthy dependencies on resume after checking manifest/lock fingerprints, runtime and service identity. A new worktree has its own dependency directory; cache reuse uses npm's supported cache rather than linked mutable installs. Relay's ignored advisory `.spec-team/local/environment.json` records non-secret versions/check references only during authorized preparation. Exposed credentials require stopping affected publication/use, human rotation/revocation and artifact/history reconciliation; ignoring/deleting a file does not revoke it.

| ENV cases | Expected validation / recovery | Owner / task |
| --- | --- | --- |
| ENV-01, ENV-02 | Fresh preparation after ticket readback; healthy resume reuses checked dependencies/sessions | Forge / T1; Lens verifies |
| ENV-03, ENV-04 | Wrong runtime/lock/partial install, full disk/offline/locked file fails dependent readiness; preserve and diagnose | Assigned writer / T1 or affected phase |
| ENV-05, ENV-06 | Wrong target/expired session blocks writes; supported refresh or one focused human MFA/action | Relay + assigned writer |
| ENV-07 | No plaintext fallback or leaked secret use; rotation/reconciliation and safe storage gate | Human security owner + Relay |
| ENV-08 | One writer/directory, owned ports/databases, native session reuse and host-local recheck | Relay / every phase |
| ENV-09 | Review unexpected hook/integrity failure; do not bypass to achieve a green install | Forge / T1 |
| ENV-10 | Global/admin changes, paid provisioning and production work need their actual authority; continue unrelated work | Relay + human owner |

All ENV outcomes are planned/unverified; definitions above are not execution evidence.

## UX, supported environments and accessibility

Treat `design-references/v2` as the required visual specification. Implement every main page from its matching screenshot, following the twelve-page mapping in `design-references/v2/README.md`; preserve composition, shared shell, action/content hierarchy, typography, spacing, and component styling. Extend that same system to all added detail/form/authentication/onboarding/technician screens. Reuse the supplied logo through `src/assets/opspilot-logo.png` on every page layout, preserving artwork, aspect ratio, colors, and transparency; organization logos do not replace OpsPilot branding. Product, permission, responsive, accessibility, and interaction-state adaptations are required where applicable, with justified differences recorded in visual review rather than an unrelated redesign.
Use the approved v2 reference direction: canvas `#FAF9F6`, stone navigation `#F0F0EB`, charcoal `#202623`, cobalt action `#2855D9`, rules `#DDDFD9`, small corners, restrained shadows, readable sans-serif and monospaced record IDs. Shared semantic status tokens pair labels/icons with color; implementation must verify contrast. Reuse suitable shadcn/Radix primitives and simple native controls; add bespoke layout only where the task benefits.

Operations roles get dashboard and exception queues; technicians start in assigned work, with clear start/block/submit actions. Inventory separates on-hand/reserved/available. Record pages show asset, ownership, status, primary action, then details/history. Work-order completion and asset release have different labels/actions/confirmation text. Preserve forms on error; distinguish loading, no data, filtered empty, denied, disconnected, failed save, stale version and uncertain committed outcome. Never display a successful optimistic approval, release or stock issue before durable acknowledgment; retry an uncertain result using its original request identity.

| Screen / flow | Hierarchy and main action | Narrow layout / important states |
| --- | --- | --- |
| Dashboard | Attention queue then availability/counts; links to filtered records | Stacked summaries; charts have table/text equivalents; no-data differs from failed refresh |
| Requests | Asset/problem/reporter then explicit triage/conversion | List/detail route; returned/rejected/withdrawn reasons and preserved drafts |
| Work orders | Filters/table/optional board, assignment/due/state, full task/evidence/history detail | Grouped list and explicit action menu; no drag-only transitions; stale-version recovery |
| Assets | Search/registry, profile, holds/availability and history | Stacked records/full detail; authenticated QR; archive never implies release |
| Maintenance | Upcoming/overdue agenda and calendar, plan/occurrence/job links | Date-grouped agenda; paused, missed-run and backlog state visible |
| Inspections | Template revision, assigned checklist, results/evidence and corrective links | Single checklist; worded Pass/Fail/N/A; required remarks/errors linked |
| Inventory | On-hand/reserved/available/reorder and movements; receive/issue as permitted | List/detail; quantity/location with explicit pending/success/conflict balances |
| Team | Assigned workload then members/roles; owner membership actions | Workload remains coordination context; deactivation and retained-history consequences explicit |
| Reports | Timezone/period/filter, inspectable definitions, source rows then export | Table/text alternatives and unknown labels; narrower-range path on bounded export refusal |
| Assistant | Own recent conversations, authorized answer/source links, draft fields/confirmation | Privacy-disabled/quota/no-evidence states; manual link and no autonomous action |
| Notifications | Filtered own inbox, safe event summary and target link | List/detail; read state separate; revoked/archived target safely unavailable |
| Settings | Organization/operational/personal groups with permission-specific saves | Labeled compact sections; timezone impacts, dirty state and conflict feedback |
| Technician workspace | Assigned job identity/instructions, progress/evidence and submit | Reachable touch actions without desktop rail; necessary asset context only |
| Auth/onboarding | Sign-in/recovery, controlled workspace bootstrap, recipient-bound invite acceptance | Short labeled forms; password-manager/paste support; expired/wrong-account recovery |

Implement all twelve v2 module areas plus missing auth/onboarding, invitations, detail/create/edit flows and mobile technician screens. Desktop tables may offer a board, but every drag action has a keyboard/button equivalent. Narrow screens use ordered lists and detail routes rather than forcing a compressed desktop table. PWA means optional installable shell; offline data synchronization is excluded. Do not cache private API responses or authenticated attachments in a service worker.

Target WCAG 2.2 AA across current/previous stable Chrome, Edge, Firefox and Safari; mouse, keyboard and touch. Check 320/375/768/1024/1280/1440/1920 CSS widths, 200% and 400% zoom, 320px reflow with documented essential-table exceptions, long names/IDs/localized text, focus order/visibility, form labels/errors, dialogs and return focus, status announcements, contrast, reduced motion and practical touch targets. Planned manual evidence includes desktop NVDA + Chrome/Firefox, Android Chrome/TalkBack and iPhone Safari/VoiceOver. Browser automation/axe checks supplement, not replace, required human/real-device evidence. Hardware/rugged-device/field usability remains human pilot acceptance, not inferred from screenshots.

## Implementation order, ownership and phases

Use one phase worktree and sequential writers by default. Forge owns database/contracts/Edge/tests; Pixel consumes agreed interfaces and owns UI/tests. Shared manifests and generated types transfer explicitly at handoff. Lens independently reviews the integrated phase; Dock integrates only under Relay after matching review, selected acceptance and required checks. Role names do not isolate credentials or enforce permissions. Progress/Linear writes belong to Relay alone.

| Phase / task | Coherent outcome and bounded files/resources | Dependencies / handoff |
| --- | --- | --- |
| P1 / T1 | Secure workspace foundation and useful onboarding journey: approved preparation, Git/CI setup, Auth/org invite/RLS, design shell, asset + submitted request + draft WO visible only to correct tenant. Forge then Pixel; core paths and shared setup. | Package approval, actual issue readback, repository/provider identity and isolated test route. Prove create org → invite → asset → request/WO → denied other tenant early. |
| P1 / T2 | Complete core repair workflow in synthetic internal increment: assignment/technician work/review/rejection/holds/release, attachments, core notifications/dashboard/team, audit and initial backup+restore rehearsal. Forge then Pixel; core commands/UI + operations docs. | T1 contracts; email transport and isolated services. Establish safety/security/recovery checks now; no private pilot data admitted yet. |
| P2 / T3 | Calendar PM and inspections: immutable templates, reliable due occurrence generation, inspection submission/defect holds/corrective requests, overdue notification and maintenance UX. | P1 accepted schema and safety contracts. No job is created twice on retry/DST/recovery; history remains immutable. |
| P3 / T4 | Parts coordination: catalog/locations, reservation/issue/return/adjustment ledger, blocked-parts workflow, low-stock notifications and reconciliation views. | P1 WOs/permissions and P2 defect workflow. Independent concurrent stock tests and human inventory process acceptance. |
| P4 / T5 | Reporting and full optional AI assistance: deterministic metrics/CSV, all allowlisted assistant modes, editable draft/priority suggestions, gateway caps/privacy/source validation and manual fallback. | Accepted operational sources; provider configuration and real-data AI gate. Reports usable with AI disabled. |
| P5 / T6 | Full V2 first external operational-pilot readiness and synthetic portfolio preparation: combined security/permissions/regression, manual device/a11y/company safety checks, measured full DB+Storage restore, email/access, monitoring and support docs. | P1–P4 accepted; actual named humans and pilot target; full combined admission gates. Private AI disabled until verified terms+consent. Publication/deployment needs actual authority. |

T1 and T2 belong to the first meaningful phase, rather than a separate setup-only project. P1–P4 are internal synthetic-data increments. The first external release admits private operational data only after full V2 P5 combined gates. Later phases do not postpone core safety/security/recovery design or tests. Linear issue/milestone IDs remain absent until Relay creates/reconciles and reads back approved resources.

### Task execution and checks

**T1 interfaces:** produces generated DB types, `CommandContext/Success/DomainError`, membership/asset/request/WO read and creation interfaces, auth/session/workspace query keys, shared tokens and isolated CI commands above.

- [ ] Forge writes failing permission/constraint tests for two tenants, existing/new-user invitations, last-owner protection, revoked membership and tenant-aware foreign keys.
- [ ] Run the isolated database/service tests and observe meaningful missing-behavior failures; implement minimal schema/RPC/Edge contracts, migrate/seed, then rerun to pass.
- [ ] Pixel implements the onboarding/asset/request/draft-WO flow using those generated types; add browser checks for validation, workspace switching and cross-tenant cache isolation.
- [ ] Pixel builds the shared shell and added screens from the v2 design system, copies the supplied logo unchanged into the proposed asset path, and verifies its use in desktop/mobile and authentication layouts.
- [ ] Run typecheck/lint/unit/build plus actual isolated integration/browser checks; record exact head/base/tree, environment, sanitized results and unresolved hosted gates. Commit only the owned delivery with repository attribution policy; hand to Lens once integrated.

**T2 interfaces:** consumes T1; produces versioned state/hold/review/release and attachment contracts, notification/dashboard read models, sanitized operations/recovery procedure and early synthetic evidence.

- [ ] Write failing tests for former-performer rejection, current-hold-scope release eligibility, separate completion/release, new blocking job vs release, canceled/archived hold bypass, retry-after-commit, revoked-member authenticated download and malformed/wrong-path attachment access.
- [ ] Implement atomic commands, immutable participation/audit, file lifecycle and core notifications/metrics; test exact transaction rollback and duplicate identities on real services.
- [ ] Implement technician/supervisor/detail/dashboard/team flows, preservation of failed drafts and stale-version feedback; browser-test repair → reject/correct → approve → separate release.
- [ ] Restore database, required Auth/configuration and file objects into an isolated environment; reconcile post-backup access changes; verify denied access, object integrity and the representative journey. Measure actual RPO/RTO.
- [ ] Review early safety/security/device/a11y risks and selected synthetic phase acceptance evidence; preserve final combined human/private-hosted gates for T6. Commit and hand the same snapshot to independent combined review.

**T3 interfaces:** consumes P1 safety/WOs/notifications; produces plan revision/occurrence, pinned inspection submission and source-linked corrective/hold contracts.

- [ ] Write failing calendar/DST/month-end/backlog/overlapping-Cron fixtures and immutable-template/failed-item-dedup tests; run to confirm failure.
- [ ] Implement bounded native Cron generation and atomic inspection/result/corrective-request/hold commands/UI; use deterministic frozen times and repeat scheduler/submission calls to prove one occurrence/job/request and retained original due date.
- [ ] Exercise overdue → generated work → inspection failure → linked corrective hold → review/release; verify cancelled/disposition paths and history. Run affected unit/database/browser checks, then commit/handoff the phase snapshot.

**T4 interfaces:** consumes WO identity/holds; produces decimal stock/reservation/ledger commands and low-stock/blocked-parts read models.

- [ ] Write failing simultaneous reserve/issue, multi-line rollback, over-return, duplicate payload/key, unit mismatch and cancellation reconciliation tests.
- [ ] Implement locked balance/ledger commands and inventory role UI; verify 20 simultaneous admissions cannot overdraw stock and a lost-response retry yields one ledger result.
- [ ] Exercise shortage → blocked WO → receipt/issue → authorized resume → completion, with recipient-only notifications; compare materialized balances to authoritative ledger/reservations. Run focused checks, commit and hand off.

**T5 interfaces:** consumes accepted transactional facts; produces bounded deterministic report rows/metrics and gateway schema-version-1 outputs with validated source references.

- [ ] Write failing date/timezone, reopened-job, overlapping-downtime, CSV formula, report-scope and large-export boundary tests.
- [ ] Implement database report definitions and report UI/CSV; compare known fixture totals without AI. Write AI fixture tests for prompt injection, unauthorized/unknown record IDs, malformed JSON, quotas/timeouts and no provider configuration.
- [ ] Implement one fetch gateway and typed retrieval allowlist; confirm AI draft creation calls ordinary authorized commands once, and no AI output controls review/release/stock.
- [ ] Run controlled provider smoke only with the approved synthetic/private arrangement; display actual provider/model/source context. Test full manual paths with AI unavailable, then commit/handoff.

**T6 interfaces:** consumes P1–P4 accepted contracts; produces complete V2 regression evidence, user/support docs and separate synthetic demo configuration.

- [ ] Run the complete isolated suite and cross-module user journeys on the final integrated snapshot; exercise bounded load, degraded services, backlog and restore.
- [ ] Compare every main page with its matching v2 PNG and supplied logo on the running application; review all added screens for the same visual identity, verify responsive/state/accessibility adaptations, and record justified differences and actual visual evidence.
- [ ] Collect actual manual keyboard/screen-reader/phone and designated human security/company-safety/recovery acceptance evidence, repair findings through their original owner, and rerun affected checks before private admission.
- [ ] Prepare public demo using synthetic records and isolated identities only; verify no private data/secrets in bundles, logs, exports, images or source fixtures. Document observed limitations and unfinished deployment authority.
- [ ] Provide Lens combined review and the owner's selected acceptance; merge/release only with matching repository/head/base/tree and enforced required checks. Preserve pending hosted/manual gates instead of describing them as passed.

## Validation, deployment and recovery

Each phase runs focused implementer checks, independent connected-code review, and separately selected manual or Lens automated acceptance. A review PASS is not acceptance; a build is not a journey; an isolated service test is not hosted production evidence. Missing mandatory permission or private-pilot evidence blocks affected release regardless of a quality score.

CI on a selected Linux runner runs locked install, typecheck/lint/unit/build, isolated Supabase migrations/RLS/service integration and critical Playwright journeys. Use meaningful negative cases and deterministic synthetic fixtures; do not assert only that implementation mocks were called. Actual provider-required check names, protection policy, actions commit pins, CI quota and repository target are verified in T1 before configuring them. Secrets are available only to narrowly scoped trusted deployment jobs, never untrusted pull-request code.

Proposed deploy sequence: inspect approved exact commit and target; back up current database/files/config references; run additive backward-compatible migrations against the authorized environment; deploy compatible Edge versions; deploy static frontend; run authenticated smoke/negative checks and observe errors. Separate preview/synthetic-test/private-pilot configuration. Do not let preview builds point to private pilot data. Cloudflare Pages supports Vite `npm run build` → `dist`; [official build configuration](https://developers.cloudflare.com/pages/configuration/build-configuration/). Cloudflare currently recommends Workers for new projects; Pages is proposed here because this app needs static hosting and the brief selects it. If Pages is unavailable or its required headers/preview controls cannot satisfy the plan, return a concrete hosting revision rather than silently adding another server. [Platform guidance](https://developers.cloudflare.com/pages/framework-guides/).

Frontend rollback returns to the prior compatible artifact. Database rollback uses tested forward correction or a deliberate isolated restore; never assume reversing a migration recovers deleted data. Add fields/tables first, deploy compatible readers/writers, backfill bounded batches, then constrain/remove only in a separately reviewed change with backup. Keep prior supported command/schema behavior through a rollout; `schema_version` changes are explicit. Stop writes if integrity is uncertain; preserve committed request identities/audit and reconcile before retry.

Free Supabase projects require an actual off-site export arrangement, not an assumed managed backup. Database backups do not include Storage object bytes. Back up schema/data/Auth as supported, Storage inventory+objects+checksums, required provider configuration references, migrations, Edge source and secret-recovery ownership; secrets themselves stay in approved secure storage. [Supabase backup guidance](https://supabase.com/docs/guides/platform/backups). Never put private backup dumps into Git or normal CI artifacts. Encrypt backups in an approved owner-controlled store, restrict access, document retention/deletion, and rehearse restoration into an isolated target before first private release.

Proposed baseline for this **real operational free-tier-first pilot**: daily encrypted backup, RPO ≤24 hours, RTO ≤4 working hours, 7 daily +4 weekly copies, plus backup before each schema deployment. These are proposed loss/time targets for package approval, not provider guarantees or achieved results. The actual business/recovery owners must approve those operational tolerances and demonstrate a measured isolated restore before P5 private admission. During an outage use the approved emergency company recording procedure; reconcile manually captured work/parts/decisions with preserved identities before restoring normal writes. A free service without suitable recoverability is insufficient regardless of small user count; pause admission or request a concrete owner-authorized resource change rather than silently purchasing. Restore includes checking who was revoked/changed after backup, invalidating or reconciling sessions/permissions, retrieving object bytes, resuming Cron safely and suppressing duplicate notifications/movements. Keep private access closed until reconciled.

Monitoring uses native provider job/usage logs plus a protected external heartbeat where an eligible free service supports it. Alert the designated owner when the last verified backup approaches 23 hours; at 24 hours without a good backup, pause new operational intake until the loss target is restored or an authorized human accepts a documented incident procedure. Check backup object existence/checksum and periodically restore; an export-job success exit alone is insufficient. At 80% of measured database/storage/egress/email/function/AI limits, or <30% measured recovery/capacity headroom, notify the owner and reduce optional exports/AI/admission before exhaustion. At 95% quota or a failing required recovery/security dependency, pause affected new intake without losing current records. Record application command/error latency, failed Cron/backup heartbeats and permission-denied anomalies without private payloads. Growth in active users is one upgrade trigger; resource pressure, error rate, provider suspension risk and recovery headroom can require a decision earlier. Spend always needs separate owner authorization.

First release requires actual human approval of retention/privacy notices, business authorization to store pilot data, emergency paper/existing-system procedure, security findings, operational-release limitations and recovery ownership. A breach/exposed credential stops affected access/publication, triggers human incident handling/rotation, preserves sanitized evidence and checks data exposure; a new secret or ignore rule alone is not recovery.

## Workload, performance and recovery assumptions

These are planning assumptions for a limited pilot, not observed customer demand or provider entitlements. Human owner confirms them before T1 capacity setup; materially larger needs revise the package. No production/third-party load test is authorized.

| Resource | Proposed bound / assumption | Acceptance / environment |
| --- | --- | --- |
| Pilot scale | Up to 3 organizations, 30 members/organization, 10 simultaneously active users total; 500 assets, 10,000 WOs, 100,000 events per organization | Synthetic isolated fixture; no tenant leakage or incorrect transitions under 20 concurrent command contenders |
| Reads | Default 25/max100 rows, stable cursor; search 200 chars; report range366 days/max10k export rows | p95 list/detail ≤1.5s and critical command ≤2s excluding upload/AI at assumed load; isolated lab, with environment stated |
| Writes | 5,000 admitted non-AI commands/tenant/day, 60 sensitive requests/user/minute, 100 invites/tenant/day subject to provider limits | Over-limit rejected safely; committed results remain discoverable, no repeated effects |
| Files | 5 MiB/file, max10 ready/record, initial tenant quota250 MiB | Reject excess before committing ready metadata; measure provider storage/egress budget, lower admission if actual quota requires |
| AI | 4k input chars, 20k retrieved text, 50 sources, 2k output tokens, 20s timeout;5/user/hour,50/tenant/day | Malformed/slow/disabled provider leaves manual operations usable; private gate enforced before transmission |
| Cron | Daily local-date evaluation;100 plans/200 occurrences per run;one unfinished occurrence/plan | Missed runs retain backlog/date; duplicate jobs impossible; alert if last successful scheduler heartbeat >26h |
| Frontend | LCP ≤2.5s, INP ≤200ms, CLS ≤0.1 at p75 real page loads | Lab proxy and interaction traces are provisional; actual field metrics require observed traffic and privacy-approved collection |
| Recovery | Proposed operational RPO≤24h/RTO≤4 working hours; monitored daily backup and measured DB+Storage+access reconciliation | Isolated destructive restore drill only; actual business tolerance approval, denied access and key workflow verified before P5 private admission |

Use a 10-second client read timeout, safe read retry at most twice with jitter, and no automatic blind mutation retry. Transient mutation retry reuses the durable request ID. Database lock timeout 5 seconds and statement timeout 15 seconds for interactive commands; return conflict/busy without partial changes. Exports have a bounded 30-second server budget. Degraded database/Storage/SMTP denies dependent actions clearly; AI outage never blocks manual core operations. Monitor provider database/storage/egress/function/email/AI limits, approaching quota and failed job heartbeats; do not claim free tiers can sustain these assumptions without measured entitlement checks.

## Case coverage and project-quality profile

All evidence starts **planned/unverified**. The companion specification defines user-facing acceptance; technical cases add the implementation boundaries below. Automated acceptance may cover only the actual environments it can exercise.

| Cases / requirements | Expected behavior / recovery | Method / owner / phase |
| --- | --- | --- |
| CASE-01/02; REQ-01/02 | Confirmed owner onboard/invite/switch; register/read/archive asset with retained history | Auth/RLS constraints + browser; Forge/Pixel T1/P1 |
| CASE-03/04/05; REQ-03 | Assigned work, blocked reason/resume, rejection/correction/completion with audit | Real transactional/browsers; Forge/Pixel T2/P1 |
| CASE-06/28; REQ-04 | Distinct release, immutable former-performer exclusion, hold/reopen/new-job races deny unsafe availability | Concurrent SQL + human business procedure; Forge T2/P1 |
| CASE-07/08; REQ-06 | Editable grounded draft; timeout/disabled provider preserves manual work | Gateway fixture + approved live smoke; T5/P4; disable-policy check T2 |
| CASE-09/10; REQ-07 | Wrong tenant/user/role/ID/session/file and revoked membership denied; cache switch isolated | Real Auth/RLS/Storage/Edge negatives + browser; T1/T2 and each added module |
| CASE-11/12; REQ-03/08 | Lost-response replay once; version conflict no overwrite; archive/deactivate preserves history | Transaction/race integration; T2/P1 and T4/P3 |
| CASE-13/29; all UI requirements | Responsive/long content/zoom/keyboard/focus/error announcements usable | Browser automation + actual AT/phone/manual; Pixel each phase, T6/P5 |
| CASE-14/25; REQ-08 | Restored DB+files+permissions usable; private pilot security/safety owners and recovery gate satisfied | Early isolated rehearsal T2/P1; full V2 restore + qualified human/private-target admission T6/P5 |
| CASE-15; REQ-09 | Own request triaged and converted once; rejected reason/history retained | SQL dedupe/role + browser; T1/T2/P1 |
| CASE-16/30; REQ-10 | DST/month end/missed/backlog/retry produce correct dated occurrence once | Frozen clock + overlapping scheduler integration; T3/P2 |
| CASE-17; REQ-11 | Immutable checklist revision, failed item hold and unique corrective link | Submission constraints + inspection journey; T3/P2 |
| CASE-18; REQ-12 | Concurrent stock admission no negative/over-return; duplicate request once; reconciliation catches discrepancy | Multi-session SQL tests + stock workflow; T4/P3 |
| CASE-19; REQ-13 | Correct recipient/tenant only, read ownership and threshold dedupe | RLS/command/cron tests + inbox journey; T2/T3/T4 |
| CASE-20; REQ-05/14 | Defined totals/ranges/timezone/reopen/downtime/cost/CSV values match fixtures | Deterministic SQL + CSV/browser; T2/T5 |
| CASE-21/27; REQ-06/15 | Allowlisted retrieval, injection/unknown ID rejected, source links authorized, privacy/caps before provider call | Gateway contract/negative tests; T5/P4; gate T2/P1 |
| CASE-22/26; REQ-01/16 | Owner-only role changes/last owner, expired/revoked/email-mismatch invites, confirmed existing user acceptance | Auth/email + SQL negatives and human SMTP check; T1/T2/P1 |
| CASE-23; REQ-07 | Private validated file; wrong parent/path/size/type and revoked-member fetch denied; no public/signed URL; orphan recovery and Blob cleanup | Real Storage/Edge and downloaded bytes; T2/P1 |
| CASE-24/30; REQ-08 | Bounded workloads/quota/timeout/backlog and recoveries preserve correctness | Isolated concurrency/degraded tests and measured reports; owners T2–T6 |
| ENV-01–ENV-10 | Preparation/reuse/failure/access/script/credential boundaries above | Live version/input/identity and smoke evidence; Forge/Relay T1 and affected resume |

| Criterion / cases | Target / scope | Rationale / risk | Verification / environment | Owner / phase | Evidence |
| --- | --- | --- | --- | --- | --- |
| Critical journeys / CASE-01–08,15–22 | Complete repair and every V2 module with deterministic facts and safe failure | Stranded or incorrect maintenance records affect real operations | Integrated synthetic service/browser journeys; independent review and selected acceptance | Forge/Pixel/Lens each phase; combined T6/P5 | Planned/unverified |
| Security / agent authority / CASE-09–12,21,23,25–28 | Applicable ASVS5L2; server tenant/role/resource/performer boundaries; no AI write authority | Private-data exposure, unauthorized operation or false approval | Real RLS/Auth/Storage/Edge negative matrix, qualified human applicability/finding review; declared pilot target | Forge/Lens + named human security/business owners; each boundary and T6/P5 | Planned/unverified |
| Design / content / interaction / CASE-03–08,13,15–22 | Matching v2 page compositions and supplied logo throughout; consistent added screens, clear action/state hierarchy, preserved/error/conflict forms, transparent AI suggestions | Preserve the requested product identity while users distinguish incomplete repair, approval, release and uncertain save | Per-page comparison with source PNGs/logo on the running synthetic UI; manual task walkthroughs and documented adaptations on supported browsers | Pixel/Muse each phase; T6/P5 | Planned/unverified |
| Responsive / accessibility / CASE-13,29 | WCAG2.2AA applicability; all specified widths/input modes with manual AT/device checks | Technicians operate on phones; inaccessible actions can strand work | Browser/reflow/zoom checks; actual NVDA/TalkBack/VoiceOver/keyboard and phone evidence | Pixel + human acceptance participants; T2 baseline, T6/P5 admission | Planned/unverified |
| Stack / contracts / maintainability / CASE-09–12,16–18,26,28,ENV-01–10 | Supported pinned intersection, lock reproducibility, native generated types and narrow transactional interfaces | Drift, schema mismatch, script execution and ambiguous ownership cause failures | Exact-version/build/type/constraint/integration checks on Windows client/Linux isolated backend; connected-code review | Forge/Pixel/Lens T1 and changed phase | Planned/unverified |
| Performance / load / recovery / CASE-11,14,18,24,25,30 | Stated bounded workload, no overdraw/duplicates, measured latency/restore and monitor thresholds | Free-tier exhaustion or lost records can halt actual operations | Isolated concurrency/degraded/DB+Storage restore; lab/field distinction and human recovery approval | Forge/Dock + human recovery owner; T2/T4/T6/P5 | Planned/unverified |

No aggregate score, passing scan or visual screenshot can offset a required correctness/security failure or a missing human/private-hosted acceptance gate.

## Assumptions, open risks and stack recipe

| Item | State / owner decision | Affected gate |
| --- | --- | --- |
| Full V2; private pilot first release; performer-disqualified review/release with same eligible reviewer allowed | Confirmed owner planning input | All phases |
| Real-data AI terms+business consent gate; real operational free-tier-first use | Confirmed owner answers; actual provider compliance/consent and service fit remain live prerequisites | P5 private admission; private AI enablement separately |
| Named actual human security/privacy, business/safety, recovery owners | Required, unassigned; no invented identity | Private release |
| Git repository/remote/provider/CI quota/protections | Unavailable/unverified; authorize and verify within approved tracked T1 | Worktrees/CI/integration |
| Disk capacity and isolated backend | Planning host constrained/no Docker; Linux CI or explicitly authorized dev target required | T1 preparation and integration evidence |
| SMTP/domain and provider/billing/privacy/free-tier limits | Unverified; default SMTP insufficient; no paid or regional entitlement assumed | Signup/recovery/invite/private AI |
| Calendar/hold/decimal/report limits and recovery baseline | Proposed explicit product policies for package approval; no hidden defaults | Relevant module acceptance |
| Physical repair truth and safety | Human-recorded performers/procedures; application cannot detect omitted repair activity or certify equipment | Business pilot process |
| Hosting | Pages proposed to match brief/static need; Workers now recommended upstream; re-evaluate only on concrete unmet requirement | Hosting authorization/preflight |

- **Recipe/source revision:** Proposed OpsPilot initial recipe in this exact technical-plan/spec package; no verified pre-existing recipe. Source inputs are `docs/projectBrief.md`, repository kit environment/workflow contracts, v2 design references, and cited official docs checked 2026-10-21.
- **Fit/limits:** Static responsive SPA plus Supabase keeps one relational source of truth and uses native Auth/RLS/transactions/Cron/Storage. Limited pilot capacity, remote/local-test constraints, SMTP, private-file handling and AI data terms are explicit gates. Avoid additional platform services unless the approved behavior demonstrably requires them.
- **Runtime/dependencies:** Observed Node24.15/npm11.12; exact candidate versions and official registry evidence above. Runtime metadata compatibility is verified; actual installation/build/integration remains unverified. T1 resolves missing compatible type/component tooling into the committed exact lock; material stack/major/security-policy changes return through package change approval.
- **Setup/locks:** Minimal approved manifest, reviewed script-free resolution, exact lock, locked reinstall, separate dependency ownership, native credential sessions and explicit binary downloads; no global installer or credential copying.
- **Contracts/security:** Native generated DB types, Zod trust-boundary schemas, tenant-aware FKs/RLS, narrow transactional RPCs, immutable histories/receipts, private validated files, source-allowlisted optional AI; versioned applicability/evidence rather than certification claims.
- **Validation/deploy/recovery:** Exact proposed scripts/isolated backend route and task checks above; additive migrations, authorized target deploy, prior-compatible frontend rollback/forward DB recovery, encrypted DB+Storage/access restoration drill and owner-approved operational limits.

## Package review

Review this document and `docs/product-spec.md` together, including proposed policy/limit details, stable cases, quality profile, recipe, phased ownership and first-private-release gates. No consequential discovery question remains pending; actual service identities, qualified named humans, capacity, privacy terms/consent and evidence are later readiness prerequisites. Relay records approval evidence and SHA-256 of the exact saved bytes separately for each document; do not edit approved bytes to record progress. No installation, Linear task creation, product implementation or deployment has been performed by this plan.
