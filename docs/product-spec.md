# Product specification: OpsPilot

Status: draft for complete package review; not approved and no acceptance evidence passed.
Prepared: 2026-10-21. Delivery boundary: full Version 2 suite, implemented in coherent phases.
Keep this document stable after approval; delivery progress and approval receipts belong in Linear and the run record.

## Summary

- **Problem and outcome:** Replace fragmented maintenance job cards, spreadsheets, and messages with traceable requests, assigned work, reviewed repairs, separate operational release, parts records, and trustworthy operational information.
- **Product owner / decision owner:** The requesting human is the package decision owner. The actual business pilot sponsor and qualified safety, security, and recovery decision owners must be designated before private pilot data is introduced.
- **Product:** A multi-tenant responsive web application/PWA for small and medium fleet, vehicle, and equipment maintenance organizations.
- **Owner-confirmed scope:** Build the full Version 2 product in phases, rather than stopping at the brief's smaller MVP.
- **Owner-confirmed launch:** A limited real-business pilot using private operational data is intended from the first release; development and verification use synthetic data until the pilot admission gates pass.
- **Owner-confirmed authority:** Supervisors, maintenance managers, and organization owners may review completion and record a separate release. A repair participant cannot approve their own completion or release the asset; an eligible completion reviewer may also perform the separately recorded release.
- **Owner-confirmed operating model:** The pilot is for real operations using available free resources first, with upgrades as usage grows. It is not restricted to a synthetic or parallel-only evaluation; no paid upgrade is silently authorized.
- **Owner-confirmed AI boundary:** Private operational data may reach an AI provider only after acceptable applicable provider terms and business consent are verified. All AI capabilities are in scope and must be tested with synthetic data; the private organization uses manual workflows until its AI gate is satisfied.

### Evidence and interpretation

`docs/projectBrief.md` Version 1.0 supplies the problem, audience, modules, security principles, proposed stack, and roadmap. Owner answers relayed during discovery supersede its narrower first-release boundary.
`design-references/v2/README.md` describes the current twelve-page visual reference set; it explicitly records that raster screens are not implemented or usability-tested behavior.
The role/read matrix, transitions, field rules, recovery defaults, module details, and release policy below are **proposed package calls** unless explicitly identified as owner-confirmed. They become agreed requirements only through package approval.
No implementation, provider terms, deployment, restoration, accessibility compliance, or pilot acceptance has been verified by this specification.

## Users and context

| User / actor | Goal | Context, constraints, and relevant access |
| --- | --- | --- |
| Organization owner | Establish workspace, manage access, oversee operations | Authenticated active membership; organization administration plus operational visibility; participation exclusions still apply |
| Maintenance manager | Coordinate schedules, assets, people, and performance | Organization operational read/write; no owner-role delegation or unrestricted account administration |
| Supervisor | Triage requests, assign jobs, review completion, record release | Organization operational visibility and coordination; cannot approve/release repairs they participated in |
| Technician / mechanic | Report issues and complete assigned work | Mobile-friendly assigned-job workspace, own requests, and asset/history context necessary for those jobs; no general organization browsing |
| Inventory officer | Keep accountable parts balances and fulfill job needs | Inventory/location/movement access and minimal linked-job context; no unrelated repair evidence, employee data, or completion/release authority |
| Pilot sponsor and qualified business reviewers | Authorize pilot use and evaluate safety/recovery responsibilities | Actual named people are prerequisites, not fabricated roles or certification supplied by an agent |

Users may belong to multiple organizations with different roles. The selected organization is always visible; changing it clears old tenant context before new records appear.
External requester/client accounts and a platform-administrator console are future work. Internal technicians can report requests without introducing an external portal.
The product records human decisions; it does not diagnose equipment, certify repair quality, replace company release procedures, or automatically actuate equipment.

### Proposed authorization matrix

| Operation | Owner | Manager / supervisor | Technician | Inventory officer |
| --- | --- | --- | --- | --- |
| Create organization; manage owner membership and organization settings | Yes | No; operational settings only where explicitly delegated | No | No |
| Invite/deactivate members; assign non-owner roles | Yes | No by default | No | No |
| Read operational requests/assets/work orders | Organization scope | Organization scope | Own requests, assigned jobs, necessary asset context | Minimal linked job/asset identifiers needed for parts fulfillment |
| Register/archive assets; manage maintenance templates | Yes | Yes | No | No |
| Submit maintenance request | Yes | Yes | Yes | Yes; own requests only outside inventory context |
| Triage/convert requests; create/assign/cancel/reopen work orders | Yes | Yes | No | No |
| Record repair progress, tasks, evidence; submit review | If assigned | If assigned | Assigned jobs | No |
| Review completion; separately record asset release | Yes, if eligible | Yes, if eligible | No | No |
| Maintain catalog, stock, reservations, issues, returns, adjustments | Yes | Read plus request/reservation coordination | Request parts; view linked availability | Yes |
| View reports and use organization-wide AI retrieval | Organization scope | Organization scope | Own authorized context only | Authorized inventory context only |
| Edit/delete audit records or erase participant history | No | No | No | No |

Permissions are checked for every authoritative operation and database/storage access, including direct requests and stale open sessions. Hiding navigation alone is insufficient.
Proposed initial model: one operational role per membership; owner designation grants owner capabilities. Different organizations may assign different roles. Future custom role builders are out of scope.
Removing an assignment, changing a role, or deactivating a member never removes historical repair participation or restores self-review eligibility.
At least one active owner must remain. A user cannot use role changes, membership cycling, or another session to bypass participation exclusions.

## Goals, scope, and non-goals

### Goals

- Complete a useful integrated manual maintenance journey early: onboarding → asset → request → assigned work → repair submission → independent completion review → distinct release record → consistent history/dashboard.
- Deliver the full suite: requests, work orders, assets, calendar maintenance, inspections, inventory, team, reports, assistant, notifications, and settings.
- Preserve a reliable account of who did what, when, why, and under which organization; preserve corrections instead of silently replacing history.
- Keep core work usable when AI is unavailable, rate-limited, or unsuitable for the data involved.
- Admit a limited real-data pilot only after required authorization, recovery, privacy, usability/accessibility, and safety-process gates pass.
- Measure useful outcomes honestly; do not invent reduced downtime, user adoption, model accuracy, or performance improvements.

### In scope

- Registration/login/account recovery, organization creation, trusted invitations, membership deactivation, role changes, and multi-organization switching.
- Asset identity/specifications, categories/sites, status, images/documents, mileage/hour readings, authenticated QR links, and maintenance history.
- Internal requests; manual and AI-assisted work order preparation; multiple technicians; tasks, progress, labor, evidence, blocking, review, cancellation, and reopening.
- Distinct completion and asset-release records with human eligibility, current-state checks, reasons, and immutable actor history.
- Calendar-based preventive maintenance, versioned inspection checklists, stock catalog/locations/reservations/movements, and threshold-based low-stock information.
- In-app notifications; dashboards; defined metrics; CSV exports; authorized AI draft, priority assistance, history/operations Q&A, and daily briefs.
- Responsive accessible forms, tables/boards, details, loading/empty/error/denied/conflict states, essential audit history, bounded queries, and documented recovery.

### Out of scope

- Subscription billing, procurement/accounting/stock valuation, ERP, GPS/telematics, external customer portal, custom workflow/permission builders, native mobile applications, and public developer APIs.
- Predictive maintenance, automated diagnosis, image-based diagnosis, autonomous approvals/releases, and equipment actuation.
- Mileage/hour-triggered automatic maintenance; readings are recorded, but only calendar triggers generate scheduled work in this delivery.
- Email/SMS workflow notifications and external messaging; transactional authentication/invitation/recovery delivery remains a necessary access dependency.
- Complex offline synchronization or offline private-record caches. The installable PWA shell does not promise disconnected business operations.
- Unrestricted production rollout or acceptance of production-critical operations merely because the limited pilot or local checks succeed.

## User journeys and requirements

| ID | Requirement / journey | Trigger and expected outcome | Priority / rationale |
| --- | --- | --- | --- |
| REQ-01 | Authentication, organization onboarding, membership | Owner establishes workspace and trusted team; current role/tenant controls every access | Foundation; wrong-person access compromises all workflows |
| REQ-02 | Asset registry, status, evidence, history | Authorized actor finds an asset and its current condition/history without erasing prior records | Core operational context |
| REQ-03 | Work order assignment, execution, review | Validated maintenance work moves through authorized states with accountable people and correction paths | First integrated journey |
| REQ-04 | Separate completion and operational release | Eligible reviewer approves completion; eligible person separately records release after current checks | Owner-confirmed safety boundary |
| REQ-05 | Consistent dashboard | Authorized user sees record-based counts, status, blocked/overdue work and selected-period completion | Operational visibility |
| REQ-06 | AI draft and manual continuity | User receives an editable validated proposal, confirms explicitly, or completes the normal form without AI | Assistance never becomes an availability dependency |
| REQ-07 | Tenant/role/storage/audit protection | Wrong-tenant or wrong-role access fails without disclosure/mutation; sensitive decisions remain attributable | Mandatory pilot admission |
| REQ-08 | Failure, contention, and recovery | Retry, conflict, interruption, and restoration have explicit safe outcomes | Private operational records cannot depend on silent success |
| REQ-09 | Internal requests and conversion | Reporter submits an issue; supervisor triages and converts it once to a linked work order | Separates reporting from operational authorization |
| REQ-10 | Calendar preventive maintenance | Due organization-local occurrences generate traceable scheduled jobs without duplicates | Prevent overlooked planned maintenance |
| REQ-11 | Versioned inspections | Assigned inspector submits results/evidence; failed items yield traceable corrective requests | Repeatable checks without rewriting history |
| REQ-12 | Inventory and job-linked parts | Authorized movements preserve balances/reservations across concurrent receipts/issues/returns | Prevent unusable or misleading stock |
| REQ-13 | In-app notification inbox | Authorized recipient sees relevant events and marks own items read; record state stays authoritative | Attention without granting access |
| REQ-14 | Reports and CSV export | Authorized user selects period/filters and receives reproducible metrics with definitions and scope | Trustworthy business information |
| REQ-15 | Grounded assistant and daily briefs | Authorized record retrieval supports answers/summaries with links and explicit uncertainty | Useful assistance without invented evidence |
| REQ-16 | Team, organization settings, and preferences | Owner manages access/settings; operational settings changes are validated, audited, and reflected consistently | Stable tenant administration |

### Onboarding, invitation, and access recovery

Proposed flow: verified account → create organization with name/timezone → invite a named email to a fixed organization and non-owner role → recipient signs in with that verified email → explicitly accepts.
Invitation possession alone never grants membership. Tokens are opaque, expiring, single-use, stored safely, and not included in QR labels, logs, audit payloads, or AI inputs.
Proposed expiry is seven days; resending revokes the prior invitation. Revoke, expire, wrong account, existing member, already accepted, and removed-member reinvitation have explicit outcomes.
Only the owner can create/revoke invitations and change membership roles; invitations cannot promote the recipient to owner. Owner transfer requires a separate explicit authenticated action to an existing verified active member.
An inviter cannot invite into another organization or delegate more authority than permitted. Acceptance rechecks invitation validity and the inviter's current authority transactionally.
Unverified accounts cannot read private tenant data. Authentication errors avoid revealing whether an arbitrary account exists.
Password recovery uses the identity provider's verified recovery flow. Losing the final owner's access does not authorize a silent support override; documented identity-verified recovery is a pilot prerequisite.
Deactivation stops future access and queued actions immediately at the authoritative boundary; history remains attributable and live assignments require explicit reassignment.

### Assets and operational state

Asset identifier is unique within an organization; serial/registration details, category, site, and recorded readings are validated. Historical readings can be corrected with a reason and linked correction, not silently overwritten.
QR labels contain only a non-secret asset route/identifier; opening it requires current authentication and resource authorization. A public label exposes no private asset details.
Proposed statuses: Operational, Under Maintenance, Out of Service, Pending Release, Inactive. Archiving retains jobs, inspections, movements, evidence references, and audit history.
Accepted corrective work defaults to blocking operation and marks an asset unavailable; completing the final blocking job can move it to Pending Release, never directly to Operational.
Future routine scheduled work is not automatically a release block. Explicit asset holds record work/inspection/manual blockers and their provenance; a failed inspection creates an unresolved hold pending authorized human disposition.
Completed-job holds clear only through the distinct eligible release action. A canceled job or corrected failed inspection needs an explicit audited human hold disposition; cancellation is not evidence that the asset is safe.
Release requires no active blocking work, no unresolved inspection/manual holds, completed required reviews, required company evidence, and an eligible current actor. Release eligibility excludes immutable repair participants of jobs/inspection remedies associated with the current unreleased hold scope since the prior release; it is not a lifetime ban on anyone who previously repaired the asset.
Creating blocking work, reopening, placing/dispositioning a hold, and releasing serialize against the same asset record. Concurrent new work or a hold cannot race a release into an Operational state.
Generic asset edits, archiving, cancellation, and status fields cannot bypass release commands or erase holds. Reactivation never revives canceled work, clears a hold, or implies release.
Asset inactivity prevents new routine scheduling and assignments while preserving history. A new blocking defect/work invalidates prior availability and remains visible even when the asset is archived.

### Requests and work order lifecycle

Proposed request states are Draft, Submitted, Returned, Converted, Rejected, and Withdrawn. Reporter submits Draft/Returned; coordinator moves Submitted to Returned, Converted, or Rejected. Reporter may withdraw Draft/Submitted/Returned before conversion. Rejection, return, and withdrawal include a reason; terminal requests retain history and a new issue uses a linked new request.
The reporter edits only their unsubmitted draft or explicitly returned request. Submitted facts remain in history; a supervisor can add triage information without impersonating the reporter.
Converting a request validates asset/tenant/permissions, creates one linked work order, and changes request state in one transaction. Repeated/concurrent conversion returns the existing link, not a second job.
Manual work orders need not originate from a request. Required fields include asset, problem/title, category, priority, responsible supervisor, and requested work; due date and evidence are validated when present.
Proposed priorities are Low, Normal, High, and Critical; no label guarantees safety or sets operational release. Critical selection requires a reason and prominent unavailable-status guidance.

| Current work order state | Permitted transition / actor | Required behavior |
| --- | --- | --- |
| Draft | Open / supervisor, manager, owner | Validate required fields; creation history and stable identity |
| Open | Scheduled / coordinator; In Progress / coordinator or assigned technician | Assignment required before work starts; record planned date if scheduled |
| Scheduled | Open or In Progress / coordinator; assigned technician may start | Reschedule with history; actual start time recorded once |
| In Progress | Blocked or Awaiting Review / assigned worker or coordinator | Block reason; review submission includes activities, task outcomes, and required evidence |
| Blocked | In Progress or Scheduled / coordinator | Explicit resolution/resumption; no automatic resumption when parts arrive |
| Awaiting Review | Completed / eligible reviewer; In Progress / reviewer rejects | Reviewer identity/time; rejection reason and old submission preserved |
| Completed | In Progress / coordinator with reopen reason | Prior approval retained as superseded; asset release re-evaluated; new submission/review required |
| Any nonterminal state | Canceled / coordinator with reason | Retain work/evidence; release reservations as applicable; stock issues require real return/reversal records |
| Canceled | No direct resurrection | New linked work order if work is needed; no erasure of cancellation history |

Technicians cannot assign themselves, change priority/due date, approve completion, cancel, or force a terminal state by calling an endpoint directly.
Multiple technicians can be assigned; everyone recording repair work is attributable. Proposed conservative completion-review eligibility excludes all current/former assigned repair participants and logged performers of that work order, not unrelated prior asset repairs.
Assignment/reassignment, work start, progress, labor, evidence, submission, rejection, approval, cancellation, and reopening append actor/time history. Repair participation is irreversible as an eligibility fact.
Completion reviewer may release only through a separate explicit action/record after rechecking current conditions and participation across the current unreleased hold scope. No UI shortcut combines the two approvals.
Concurrent edits use conflict feedback; stale forms cannot silently overwrite newer state. Duplicate mutations/retries reuse a request identity where needed and return the committed result.

### Preventive maintenance and inspections

Authorized coordinators define asset/template, organization-local calendar interval, start/anchor date, due date policy, assigned personnel, and required checklist. Pause/archive affects future generation only.
Each plan occurrence has stable identity and generates at most one work order. A schedule change preserves already generated work and template/occurrence history.
Proposed recurrence follows the anchored local calendar rather than completion-time drift. DST and month-end behavior are deterministic, visible before saving, and covered by tests.
Missed execution creates visible pending backlog processed in bounded batches; it never silently skips due work or floods users with unlimited jobs. No generation is reported successful without durable records.
Inspection templates are versioned; submitted results retain their original item labels/rules. Applicable items require Pass, Fail, or Not Applicable; N/A needs a reason.
Inspector identity/time, remarks, and required evidence are recorded. Failed safety-relevant items block release and create or link one corrective request per failure, without duplicate requests on retry.
Submitting an inspection does not complete a repair or release an asset. Correcting an erroneous result preserves the old result, correction reason, and actor.

### Inventory and parts-shortage recovery

Catalog includes part identity/number, description, fixed unit, location balances, reorder threshold, and archived status. Quantities use fixed-unit decimal values to three fractional places; unit changes with history require a new catalog item or explicit migration.
Available stock equals on-hand less active reservations. Transactions enforce nonnegative on-hand/available stock and tenant-consistent job, location, and item references.
Reserve, partially issue, return, receive, and adjust use durable movement identities. Issue consumes stock and reduces the corresponding reservation once; it never subtracts the reservation twice.
Returns cannot exceed issued unreturned quantities. Adjustments require a reason and authorized actor; posted movement history is corrected through linked reversals, not deletion.
Two users cannot both reserve or issue the final quantity. Conflicts identify current availability and require explicit correction rather than silently reducing the requested amount.
Shortages can block work with a parts reason and notify authorized inventory/coordinating staff. Receipt changes availability but does not resume work, approve completion, or release equipment.
Canceled jobs release unused reservations; already consumed parts remain traceable. Inventory officers see only the job context necessary to fulfill the transaction.

### Dashboard, reports, and notifications

Dashboard counts and filtered records share consistent definitions: active work excludes Completed/Canceled; awaiting review is separate; blocked is explicit; overdue means due time passed and nonterminal.
Asset availability comes from operational state, not completed-job counts. A selected organization-local date range is converted consistently; the interface displays period/timezone and last refresh state.
Reports cover work trends, turnaround, downtime from recorded unavailable intervals, recurring issues by recorded category, workload, preventive/corrective work, and parts consumption. Missing inputs yield unknown/incomplete labels, not fabricated zeroes.
Recorded labor/parts costs may support clearly labeled spending estimates, but no valuation/accounting system is introduced. Metric formulas and exclusions are inspectable.
CSV export applies current permissions/filters, includes scope/timezone/column meanings, handles spreadsheet formula injection safely, and rejects unbounded requests with a useful narrower-range path.
Notifications cover assignment/status/review, due/overdue work, and low stock. Recipients derive from current tenant/role/assignment; one event does not create unbounded duplicates.
Users can mark only their own notifications read. Opening a notification rechecks current record permission; revocation/deletion/archive yields a safe unavailable view without leaking cached content.
The inbox is advisory; missed delivery never changes authoritative job state or hides work from ordinary lists.

### AI assistance, privacy, and free-tier behavior

AI produces editable drafts and priority suggestions, authorized operations/history answers, and daily briefs. Deterministic rules and human decisions override suggestions; the model never performs release, stock, membership, or approval operations.
The server resolves tenant/role/resource permissions before retrieval, validates structured output, and revalidates current permissions and fields before a confirmed save. Asset ambiguity requires a human choice.
Assistant answers cite underlying authorized records, identify date range and missing data, distinguish facts from suggestions, and say when no supported answer exists. Calculations run in application/database logic.
Maintenance notes/uploads/user prompts are untrusted data. Prompt injection cannot expand retrieval scope, invoke arbitrary SQL/tools, disclose secrets, or authorize a mutation.
Owner-confirmed gate: disable sending private operational data to an AI provider until acceptable applicable terms, data handling/retention arrangements, business consent, and configuration are verified. Offer synthetic AI demonstrations and normal manual workflows meanwhile.
Full-suite delivery does not claim that AI is enabled for private pilot records. Every AI capability must be implemented and verified with synthetic data before acceptance; private-organization enablement remains a separate observed readiness gate.
Do not assume a free service has acceptable confidentiality, available quota, commercial eligibility, regional handling, or future availability. A provider/local choice and any budget requirement belong in the technical plan and owner decision.
Proposed controls: per-user/organization request caps, bounded input/context/output, timeouts, limited retries, explicit quota notices, and usage/outcome metadata without secrets or raw private prompts by default.
An invalid, refused, timed-out, or rate-limited AI result causes no business mutation. Preserve entered form text where safe; user can retry deliberately or continue manually.
Previously generated output is not silently regenerated/saved after network recovery. Confirmation applies to the displayed draft/version, and audit links the approved fields to its suggestion metadata.

### UX, PWA, and shared interaction states

`design-references/v2` is the required visual specification for OpsPilot, not optional inspiration. Each of the twelve main pages must faithfully implement its matching PNG, using the page-to-file mapping in `design-references/v2/README.md`. Preserve the shared application shell, page composition, content/action hierarchy, typography, spacing, component styling, and visual identity. Additional authentication, onboarding, detail, creation/editing, and technician screens must extend the same design system.
Use the supplied `design-references/v2/00-opspilot-logo.png` as the OpsPilot product logo across all pages: the desktop shell, responsive/mobile shell, and authentication/onboarding layouts. Preserve its artwork, aspect ratio, colors, and transparency; do not redraw or substitute a different logo. An organization's own logo is separate from the OpsPilot product identity.
Adapt the reference layouts where required by the product's real data/workflows, role permissions, responsive behavior, accessibility, and loading/empty/error/denied/conflict states. Preserve the reference identity through those adaptations and record justified visual differences during UI review; do not introduce an unrelated redesign.
Use the current Version 2 reference direction: warm white canvas, stone navigation, charcoal text, cobalt actions, consistent tokens/components, and task-appropriate tables/board/calendar/inbox/conversation.
Proposed tokens follow the references: canvas `#FAF9F6`, navigation `#F0F0EB`, text `#202623`, actions `#2855D9`, rules `#DDDFD9`; system sans-serif, monospaced record IDs, 4px corners, and a 4/8px spacing rhythm. Contrast remains to be measured in actual states.
Show organization identity, current page, and one primary action consistently. All twelve reference modules are included in the final suite but shown only to eligible roles; internal increments expose no dead or fake navigation.
Generated example records, totals, roles, and text are illustrative only. Detail/create/authentication/onboarding/mobile states need deliberate design; no raster screen establishes their behavior.

| Screen / flow | Purpose and hierarchy | Narrow-screen and state adaptation |
| --- | --- | --- |
| Dashboard | Attention queue for blocked/overdue/review, then availability/counts and linked work | Stack summaries; distinguish empty records from filtered no-results; charts have text/table equivalent |
| Requests | Reporter/asset/problem/evidence, then explicit coordinator triage/conversion | List-to-detail route; preserve input on validation; Returned/Rejected/Converted history explicit |
| Work orders | Table and board filters; assignment, due/priority/state, detail and chronological activity | Grouped list and state-action menu; no drag-only transitions; conflict/current state explained |
| Assets | Registry/search, profile, actual availability, active holds/work and history | Stacked records/full profile; authenticated QR route; archive does not imply release |
| Maintenance | Upcoming/overdue list and calendar; plan occurrence/generated-job links | Date-grouped agenda; paused/missed-run/backlog states visible |
| Inspections | Templates/results, checklist responses, remarks/evidence, corrective links | Single readable checklist; worded Pass/Fail/N/A; inline missing-evidence errors |
| Inventory | On-hand/reserved/available/reorder figures and movement history | Record list/detail; quantity/location forms show pending/result/conflict without misleading balances |
| Team | Workload coordination plus members/roles | Workload is context, not performance grading; scoped permissions and deactivation consequences explicit |
| Reports | Period/timezone/filters, defined metrics, source records, export | Text/table alternatives; missing inputs say not recorded; bounded export errors give a recovery path |
| Assistant | Authorized answer, source records, uncertainty, editable proposed fields | Manual-workflow link; privacy-disabled/quota/no-evidence states; no auto-save or release action |
| Notifications | Filtered inbox and selected event detail | List-to-detail route; read state separate from underlying record state; revoked links safely unavailable |
| Settings | Organization versus personal settings; compact labeled sections | Save/unsaved/denied/conflict feedback; timezone effects and owner-only changes explicit |
| Technician workspace | Assigned work first, job identity/instructions, progress/evidence and submit | Reachable primary actions without desktop rail; necessary asset context; review/release kept distinct |
| Authentication/onboarding | Sign-in/recovery, bootstrap workspace, invite acceptance and role context | Short labeled forms, password-manager/paste support, expiry/wrong-account/denied recovery |

Every primary page and mutation has loading, empty, validation, success, error, denied, conflict, and stale/offline feedback as applicable. Never show a success notification before durable success is known.
Desktop supports coordination and dense records; mobile prioritizes assigned work, clear job identity, large actions, evidence capture, and review context without hiding required information.
Target WCAG 2.2 AA: semantic controls/tables, keyboard access, visible focus, proper dialog focus/return, labels/error associations, contrast, non-color statuses, reduced motion, and reflow at 320 CSS pixels except justified table/diagram exceptions.
Verify touch use, representative/boundary widths, 200%/400% zoom, long names/notes, localization-ready date/number formatting, and required assistive-technology journeys. Automated checks supplement manual checks.
Proposed widths are 320, 375, 768, 1024, 1280/1440, and 1920 CSS pixels. Narrow layouts replace the rail with a labeled drawer, boards with grouped lists/actions, calendars with agendas, and split panes with list-to-detail routes.
Proposed browser baseline is current and previous stable Chrome, Edge, Firefox, and Safari; exact tested versions are recorded in evidence. Keyboard alternatives exist for all drag actions; charts have text/table equivalents.
Required manual evidence includes iPhone Safari, Android Chrome/TalkBack, desktop NVDA with Chrome or Firefox, VoiceOver/Safari, and keyboard-only flows. Unavailable device/assistive-technology checks stay unverified and block their required admission gate.
Online-first PWA may cache only public/static shell resources. No private API responses, attachments, prompts, or tenant records enter offline/service-worker caches; signing out clears applicable client state.
Lost connection shows unconfirmed/unsent state and disables unsafe transitions. User can copy/retry a draft; no queued invisible repair approval, release, stock, or membership action replays after reconnect.

## Acceptance criteria

- [ ] Owner can register, recover access, create organization, invite verified members, switch organizations, and revoke access without cross-tenant leakage.
- [ ] Full manual corrective journey works, including multiple technicians, blocked work, rejection/correction, independent completion, and distinct eligible release.
- [ ] Technician/inventory/coordinator/owner boundaries and immutable participant exclusions hold through direct API/database/storage requests and role changes.
- [ ] Asset, job, inspection, stock, dashboard, report, notification, and audit views reconcile after committed changes and recover safely from stale sessions/retries.
- [ ] Requests convert once; calendar occurrences generate once; failed inspection items retain versioned evidence and linked corrective requests.
- [ ] Concurrent inventory reservations/issues/returns preserve balances, with explicit shortage/conflict recovery and no automatic job resumption.
- [ ] AI drafts and grounded answers satisfy authorization/validation/privacy limits; all core work remains usable when AI is disabled or fails.
- [ ] All twelve main pages faithfully follow their matching v2 references, the supplied OpsPilot logo is used across every page layout, and additional screens share that design system; required responsive/accessibility/state adaptations are reviewed against the references.
- [ ] Responsive, keyboard, manual accessibility, upload, bounded-query, contention, and degraded/recovery checks pass in their declared supported environments.
- [ ] Pilot has explicit named safety/security/recovery owners, approved operating limitations, access/privacy controls, and demonstrated restoration before private data is admitted.
- [ ] Every applicable case has actual result/evidence/environment in the phase report; planned tests, reviews, builds, or raster references do not count as acceptance.

## Constraints, assumptions, and unresolved decisions

| Item | Confirmed / assumed / unknown | Evidence or owner decision needed | Impact if unresolved |
| --- | --- | --- | --- |
| Full suite, phased delivery | Confirmed | Owner discovery answer; supersedes brief §13 boundary | Defines package scope |
| Limited private operational pilot from first release | Confirmed | Owner discovery answer | Security/privacy/recovery are admission gates, not later polish |
| Review/release eligibility and distinct records | Confirmed | Owner answer; repair participant excluded; reviewer may release | Mandatory workflow invariant |
| Private-data AI confidentiality gate | Confirmed policy; actual provider readiness unverified | Acceptable verified terms and business consent before private inputs | Private external AI remains disabled until observed |
| Real operational pilot, free resources first | Confirmed | Owner answer; upgrades as usage grows, no automatic paid spend | Plan operational record safety; do not reframe as parallel-only |
| Named pilot sponsor/safety/security/recovery reviewers | Unknown | Actual business humans and escalation path before pilot | Blocks private-data admission |
| Detailed read scopes, role matrix, state rules | Proposed | Package calls above, subject to owner approval | Controls implementation and case expectations |
| Online-first, calendar-only PM, fixed-unit stock, CSV/in-app limits | Proposed | Economical package defaults consistent with brief | Prevents ambiguous future scope |
| Recovery time/loss, retention, workload, upload/query limits | Proposed package decisions in technical plan | Measurable targets, daily encrypted exports, restoration rehearsal | Evidence required before operational readiness |
| $0 development/free-tier services | Brief constraint | Live eligibility/limits and safe private-data fit must be verified | Budget/scope escalation if safe fit is unavailable |
| Actual browsers/devices/connectivity and pilot volume | Unknown | Pilot sponsor supplies representative use and scale | Needed to finalize environment/quality profile |

## Dependencies and risks

| Dependency / risk | Effect | Mitigation or decision | Owner |
| --- | --- | --- | --- |
| Authentication/invitation delivery and recovery | Wrong-person membership or inaccessible final owner | Verified recipient binding, revocation, tested recovery, no support bypass | Atlas/Forge; pilot owner |
| Tenant/file/AI authorization | Disclosure of private operational data | Database/server/storage boundaries; negative multi-tenant cases; independent review | Atlas/Forge/Lens; named security owner |
| Incorrect completion/release or bypass via reassignment | Unsafe operational interpretation | Separate records, immutable participation, current blocking checks, qualified company process | Business safety owner; Atlas/Forge |
| Free-tier quota/suspension and background-run limits | Delayed schedules, uploads, reports, or outage | Bounded work, visible backlog, manual continuity, measured limits, escalation before pilot | Atlas/Relay; pilot sponsor |
| Data loss or restoration failure | Unreliable operational history | Approved loss/time targets, protected exports/backups, tested restore/reconciliation | Named recovery owner; Atlas/Forge/Lens |
| AI confidentiality and hallucination | Private-data exposure or unsupported action | Pending privacy gate, restricted retrieval, linked evidence, human confirmation, manual fallback | Business data owner; Atlas/Forge |
| Full-suite scope and accessibility gaps | Delayed useful workflow or unusable technician experience | Coherent phases, early manual slice, reusable components, representative manual checks | Relay/Atlas/Muse/Pixel/Lens |

## Case coverage

All cases are planned/unverified. Local and staging use synthetic data; private pilot execution is allowed only after pilot admission. Applicability is explicit in each row; no category implies a passed result.

| ID / Requirement | Category / applicability | Actor / Preconditions | Trigger | Expected behavior / Recovery | Verification / Environment |
| --- | --- | --- | --- | --- | --- |
| CASE-01 / REQ-01 | Normal; core | New owner; verified account | Create workspace and invite team | Correct tenant/role; intended recipient accepts; failures leave no partial membership | Browser + authorization assertions; synthetic local/staging; planned |
| CASE-02 / REQ-02 | Normal; core | Asset-authorized coordinator | Register/view asset and readings | Valid tenant-unique identity, status/history; invalid fields explained | Browser + constraint tests; synthetic local/staging; planned |
| CASE-03 / REQ-03,05 | Normal; core | Coordinator and assigned technicians | Assign, start, submit, review | Valid durable transitions; actor/times/dashboard/history agree | Multi-account E2E + database assertions; synthetic staging; planned |
| CASE-04 / REQ-03 | Edge; core | Reviewer; submitted repair | Reject, correct, resubmit | Reason and old evidence retained; In Progress then new review; no premature completion | Transition + browser tests; synthetic local/staging; planned |
| CASE-05 / REQ-03,12 | Edge; core/full suite | Active job; parts unavailable | Block, receive parts, resume | Reason visible; receipt never resumes job; coordinator explicitly resolves | Integration + browser; synthetic staging; planned |
| CASE-06 / REQ-04 | Worst; release | Completed repair; unreleased asset | Approve then attempt release | Separate action; eligible actor/current blocking checks; no automatic Operational status | Permission/state tests + qualified human scenario; synthetic staging; planned |
| CASE-07 / REQ-06 | Normal; AI-enabled | Authorized creator; synthetic permitted prompt | Generate/edit/confirm draft | Editable validated fields; no pre-confirmation mutation; asset ambiguity resolved | Stubbed provider + browser; synthetic local/staging; planned |
| CASE-08 / REQ-06,08 | Edge; all AI use | User entering work | Timeout/quota/refusal/bad output | No mutation; entered draft recoverable; useful manual continuation | Fault-injected gateway + browser; isolated synthetic local/staging; planned |
| CASE-09 / REQ-07 | Worst; all private resources | Wrong tenant/user/role | Guess IDs; direct API/DB/storage/AI access | Deny without disclosure/mutation; safe return; no privileged secrets | Negative permission matrix; isolated two-tenant synthetic environment; planned |
| CASE-10 / REQ-01,07 | Edge; membership | Multi-org or revoked member; open page | Switch organization/reuse stale session | Old context cleared; current permission enforced; stale action safely denied | Multi-account E2E/API; synthetic staging; planned |
| CASE-11 / REQ-03,08 | Edge; mutations | Two editors/unstable connection | Double submit, lost response, conflicting transition | One durable result or explained conflict; no duplicate/silent overwrite | Concurrency/fault-injection tests; isolated synthetic local/staging; planned |
| CASE-12 / REQ-02,07,08 | Edge; retained history | Existing asset/jobs/member history | Archive/deactivate/correct record | History/audit/participation retained; assignments explicitly handled; no destructive audit edits | Constraint/permission + browser tests; synthetic local/staging; planned |
| CASE-13 / REQ-03,08 | Edge; responsive core | Technician; narrow/touch/keyboard UI | Update job with validation/network failure | Readable ownership/actions; accessible errors; unconfirmed state and deliberate retry | Manual browser/touch/keyboard at boundary widths; synthetic staging; planned |
| CASE-14 / REQ-08 | Worst; hosted admission | Recovery owner; seeded backup | Service loss and restoration rehearsal | Approved loss/time boundary met; integrity/reconciliation demonstrated; outage honestly visible | Isolated restore exercise; synthetic staging before pilot; planned |
| CASE-15 / REQ-09 | Normal/edge; requests | Reporter + coordinator; submitted request | Triage/reject/return/concurrent conversion | Actor boundaries; one linked job transactionally; returned details/history preserved | Browser + concurrent integration; synthetic staging; planned |
| CASE-16 / REQ-10 | Normal/edge; PM | Active local-calendar plan | Due date, DST/month-end, changed plan, missed run | Stable occurrence; one job; old occurrence unchanged; visible bounded backlog | Clock-controlled recurrence tests + browser; synthetic local/staging; planned |
| CASE-17 / REQ-11 | Normal/edge; inspections | Assigned inspector; versioned checklist | Submit failure/N/A then retry/template edit | Required reasons/evidence; one corrective request; original version/results retained; release block | Integration + browser; synthetic local/staging; planned |
| CASE-18 / REQ-12 | Worst; stock integrity | Inventory officers; final available quantity | Concurrent reserve/issue/return/retry/adjust | No negative/double stock; quantity/tenant validation; correction via reversal; useful conflict | Transaction/concurrency tests + reconciliation; isolated synthetic database; planned |
| CASE-19 / REQ-13 | Normal/edge; notifications | Current authorized recipient | Event duplicate/read/link after revocation | Bounded deduped own inbox; read isolation; target permission rechecked | Event/API + browser tests; synthetic staging; planned |
| CASE-20 / REQ-05,14 | Normal/edge; reporting | Authorized manager; known fixtures | Period/timezone/filter/export | Counts/formulas match records; missing data labeled; scoped formula-safe bounded CSV | Fixed-fixture query/export + browser; synthetic local/staging; planned |
| CASE-21 / REQ-15,07 | Worst; assistant | User with scoped context; malicious note present | Ask summary/inject instructions/no evidence | Authorized facts/citations only; no arbitrary tool/SQL/mutation; unknowns explicit | Adversarial contract/retrieval tests + review; synthetic local/staging; planned |
| CASE-22 / REQ-16,01 | Edge; team/settings | Owner; active assignments/schedules | Role/deactivation/timezone/last-owner change | Validated authorized change; last owner protected; old events preserved; future behavior explicit | Permission/clock tests + browser; synthetic staging; planned |
| CASE-23 / REQ-02,03,07 | Worst; uploads | Authorized uploader; malicious/oversized file | Upload/open/replace/guess URL | Type/size/resource bounds; private access; no executable preview/disclosure; recoverable failed upload | Upload/storage negative tests + browser; synthetic staging; planned |
| CASE-24 / REQ-05,08,14 | Edge; bounded workload | Representative synthetic pilot volume | Long lists/search/export/burst/degraded service | Pagination/bounds/timeouts; stated latency limits measured; no production load testing | Agreed isolated load/lab checks; staging; planned, not field evidence |
| CASE-25 / REQ-04,07,08 | Worst; pilot admission | Named actual business reviewers | Request introduction of private operational data | Security/privacy/safety/recovery/accessibility evidence reviewed; unresolved hard gates block admission | Independent review + actual human decisions; declared pilot environment; planned |
| CASE-26 / REQ-01,07 | Worst; invitations | Attacker/wrong email/revoked inviter | Replay/expire/forward/accept revoked invite | Verified recipient binding; one acceptance; no extra authority; no token leakage; deliberate reinvite recovery | Token lifecycle/concurrency/permission tests; synthetic staging; planned |
| CASE-27 / REQ-06,15,07 | Worst; AI privacy/quota | Private record context; AI policy not satisfied | Send prompt/exceed cap/switch provider | External private-data send denied; synthetic/manual route; caps and notices; no secret/raw prompt logs | Gateway policy/fault tests + configuration review; synthetic staging; planned |
| CASE-28 / REQ-04,07 | Worst; release race | Former repair participant or competing blocker | Role change/reassignment then review/release | Historical exclusion holds; release atomically rechecks blockers; conflict cannot mark available | Concurrency + actor-history permission tests; synthetic database/staging; planned |
| CASE-29 / REQ-01,03,16 | Edge; accessibility/content | Keyboard/assistive-tech user; long content | Onboard, edit, dialog, error, zoom/reflow | Focus/labels/status/errors usable; content not lost; non-color meaning; manual gate remains explicit | WCAG-focused manual + automated checks; supported browsers/AT; synthetic staging; planned |
| CASE-30 / REQ-08,10,12,13 | Edge/worst; degraded provider | Queue/backlog near verified resource limit | Scheduler outage, quota exhaustion, reconnect | Visible unprocessed work; bounded retry/dedupe; no skipped/phantom jobs or inventory replay | Controlled outage/quota/recovery checks; isolated synthetic staging; planned |

## Delivery boundary and pilot admission

Implementation phases must prove one manual integrated journey early, then add related modules without turning every screen into a separate project. Atlas owns the detailed dependency/order and checks.
Proposed release boundary: phases produce internal synthetic-data increments; the first external release is the full twelve-module Version 2 operational pilot after combined authorization/security, restoration/recovery, transactional email/access, accessibility, and company safety-process gates pass.
No private business records enter early development/demo environments. Private pilot admission is a deliberate release gate; primary operational record safety, downtime/loss limits, reconciliation, and recovery authorization are specified in the technical plan.
Proposed pilot access is controlled: one authorized bootstrap owner, invited verified users, and explicit organization onboarding; unrestricted public self-service tenant creation is disabled for the limited pilot. This is a package choice, not an owner-confirmed registration preference.
The pilot uses free resources first. Verify actual limits and preserve bounded safe operation; growth motivates upgrades, while an earlier confidentiality, reliability, capacity, or recovery shortfall triggers an explicit owner decision or controlled intake pause, never silent paid spend or an invented SLA.
Proposed recovery baseline includes daily encrypted exports, protected key/access handling, monitored export success, and a demonstrated restoration/reconciliation rehearsal. An export file alone does not prove recoverability; the technical plan sets measurable loss/time and retention targets.
Business safety, security, and recovery owners must be actual designated humans before private-data admission. Qualified company safety review determines fitness for operational procedures; application/agent review is not maintenance certification.
Record actual scope, environment, human/automated acceptance choice, commands/scenarios, remaining limitations, and approval evidence. A build or code-review PASS alone does not authorize pilot use.

## Package review

Present this saved specification with `docs/technical-plan.md` and SHA-256 values of both exact saved files for one owner decision. This draft does not approve itself.
Resolve or explicitly obtain owner agreement on consequential unknowns before dependent implementation. Capture the same actual owner message in separate specification and plan receipts.
Keep planned case/quality evidence unpassed; record subsequent progress and results outside these approved document bytes.
