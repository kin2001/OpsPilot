# Technical plan: <product>

Status: draft for package review. Keep approved bytes immutable; put execution progress in the run record and tracker.

## Purpose and specification reference

- **Product specification:** <repository-relative path and revision>
- **Requirements in scope:** <IDs>
- **Goals / non-goals:** <short result and boundary>

## Existing project and stack

- **Verified repository paths and behavior:** <current source paths/callers; distinguish observations from proposals>
- **Existing stack and versions:** <verified versions or unknown>
- **Relevant patterns and limits:** <verified source/revision>
- **Recipe decision:** <verified suitable recipe, adequate existing stack, or justified fresh evaluation>

## Architecture and boundaries

Describe the smallest architecture that satisfies the approved behavior. Identify modules/services, ownership boundaries, data flows, trust boundaries, relevant external systems, and why the structure fits.

## Data and API contracts

| Contract / entity | Producer and consumer | Shape / version | Error and permission boundary | Compatibility / migration |
| --- | --- | --- | --- | --- |
| <contract> | <roles/modules> | <schema/version> | <expected behavior> | <plan or N/A reason> |

Prefer existing native schemas/types or supported HTTP contract formats. Agree error and authorization boundaries before concurrent implementation.

## Authentication, authorization, and security

- **Assurance target and version:** <applicable target; production accounts/private data target applicable OWASP ASVS Level 2>
- **Applicability and exclusions:** <scope and reason>
- **Trust boundaries and sensitive data:** <flow and handling>
- **Role / resource / operation permissions:** <matrix or linked approved design>
- **Abuse and negative cases:** <relevant case IDs, including wrong-user/tenant, privilege/session/ID as applicable>
- **Escalation assessment:** <higher-impact risks, named human decision owner, whether qualified human review is required>
- **Evidence:** <planned checks and environment; target/scan is not certification>

## Development environment preparation

Follow the kit's `.agents/skills/spec-team/references/environment.md` contract, resolved from the actual kit source root. Inspect read-only during planning; prepare the assigned worktree after this package's approval and actual Linear task readback. Include setup in the first relevant coherent task, with Relay coordinating and Pixel or Forge assigned. Lens checks evidence in existing phase gates.

- **Runtime / package manager / OS and architecture:** <observed compatible versions, requirements and unknowns>
- **Manifests / lockfiles / initialization:** <paths, minimal approved creation for fresh products, locked install and mismatch/recovery behavior>
- **Preparation owner / task / resources:** <role/task, dependency directories, ports/services/databases; one directory writer>
- **Exact install / verification / repair commands:** <version-supported commands, directory, effects, disk/permission/network checks, expected results; reuse healthy installations>
- **Package sources / install-time scripts / isolation:** <approved registries/necessary hooks, minimum credential environment and required effective boundaries>
- **Services / identity / environment / permissions:** <intended accounts/projects and development targets, native credential storage and redacted checks; Linear sign-in may precede tickets>
- **Local secrets / public examples / output exclusions:** <variable names only, required ignored/untracked restricted local files, client/build/container/archive checks and exposure recovery>
- **Resume / observations / blockers:** <non-secret controller receipt, inputs requiring recheck, expiry/refresh/MFA path, partial-install recovery and affected dependent work>
- **Applicable ENV cases / validation:** <ENV-01 through ENV-10 as relevant, expected behavior/recovery, owner and actual method; start unverified>

## UX and environments

- **Purpose, hierarchy, identity, and interaction states:** <Muse proposal / approved reference>
- **Supported browsers, devices, and input modes:** <applicability and target>
- **Responsive and accessibility checks:** <fluid layout, representative/boundary widths, long/localized content, zoom, keyboard/focus/forms/dialogs, 320 CSS-pixel reflow and applicable exceptions, touch/reduced motion, manual evidence>
- **If non-UI:** <why each UI dimension is N/A>

Prefer suitable proven components. Explain valuable bespoke design choices. Automated scans do not replace a required manual or real-device gate.

## Implementation order, ownership, and phases

| Order | Coherent task / outcome | Role and files/resources | Dependencies | Phase / handoff |
| --- | --- | --- | --- | --- |
| <1> | <observable delivery> | <role and bounded ownership> | <contract/input> | <phase and return evidence> |

Default to one phase worktree and sequential writers. Use separate worktrees only for genuinely independent work with explicit file/shared-resource boundaries. Prove one applicable end-to-end journey early in the first meaningful phase.

## Validation and operations

| Criterion / case IDs | Check and expected outcome | Environment | Owner / phase | Evidence status |
| --- | --- | --- | --- | --- |
| <IDs> | <check> | <local/hosted/device/etc.> | <role/phase> | Planned / unverified |

Include focused implementation checks, independent combined review, selected manual or Lens automated phase acceptance, required repository CI/protection, and any separate hosted/device/accessibility/field gate. Distinguish mocks, build checks, local tests, and live product evidence.

## Deployment, migration, rollback, and recovery

Describe deployment and data-change sequence only as applicable; identify safe rollback or forward recovery. Record timeout/retry/idempotency, bounded queries/uploads, contention, restore behavior, recovery-time target, and acceptable-loss criteria where relevant. No production or third-party test is implied.

## Workload, performance, and recovery assumptions

| Workload / resource | Assumption and limit | Required criterion | Test environment and evidence |
| --- | --- | --- | --- |
| <traffic/data/provider> | <measured or assumed> | <justified latency/error/capacity/recovery> | <planned/unverified> |

For web experiences, apply LCP <= 2.5s, INP <= 200ms, and CLS <= 0.1 at the 75th percentile of real page loads where relevant. Mark laboratory results provisional and keep future field observations separate. Expand burst, sustained, degraded-dependency, and restore checks only for real workload/impact.

## Assumptions, decisions, and open risks

| Item | State | Evidence / owner decision | Affected task or gate |
| --- | --- | --- | --- |
| <item> | <confirmed, assumed, or unknown> | <source/question> | <impact> |

## Case coverage

Carry every relevant product case ID forward. Atlas adds contract, permission, failure, and recovery cases; Muse adds applicable interface states. Assign owner and task/phase evidence. Cases start planned/unverified; missing critical expected behavior returns to package decisions before implementation.

| ID / Requirement | Category | Actor / Preconditions | Trigger | Expected behavior / Recovery | Verification / Environment | Owner / Task / Phase |
| --- | --- | --- | --- | --- | --- | --- |
| <CASE-01 / REQ-01> | <normal, edge, or worst> | <actor/state> | <event> | <result and recovery> | <method/environment; planned/unverified> | <role/task/phase> |

## Project quality profile

Record a target and scope, rationale/risk, verification method/environment, owner/phase, and evidence status for every applicable dimension. Mark N/A only with a reason. Required failed or unavailable criteria block acceptance regardless of any aggregate score.

| Criterion / Case IDs | Target / Scope | Rationale / Risk | Verification / Environment | Owner / Phase | Evidence status |
| --- | --- | --- | --- | --- | --- |
| Critical journeys / <CASE IDs> | <observable end-to-end behavior> | <user impact> | <method and environment> | <role/phase> | Planned / unverified |
| Security / agent authority / <CASE IDs> | <applicable controls and real boundaries> | <data/authorization impact> | <negative cases and environment> | <role/phase> | Planned / unverified |
| Design / content / interaction / <CASE IDs> | <product-specific quality and states, or N/A with reason> | <user task/brand risk> | <running interface and interaction checks> | <role/phase> | Planned / unverified |
| Responsive / accessibility / <CASE IDs> | <supported environments and WCAG applicability, or N/A with reason> | <audience/input risk> | <boundary/manual checks> | <role/phase> | Planned / unverified |
| Stack / contracts / maintainability / <CASE IDs> | <supported versions, contract behavior, maintainable integration> | <compatibility/change risk> | <contract and integrated checks> | <role/phase> | Planned / unverified |
| Performance / load / recovery / <CASE IDs> | <workload, limits, latency/errors, restore expectations> | <capacity/data-loss risk> | <isolated workload/failure/restore evidence> | <role/phase> | Planned / unverified |

## Stack recipe and integration

- **Recipe / Source revision:** <approved verified recipe and revision, adequate existing stack, or none yet>
- **Fit / Limits:** <why it fits this product and known constraints>
- **Runtime / Dependency versions:** <supported versions and evidence>
- **Setup / Lockfiles:** <reproducible setup and lockfile contract>
- **Contracts / Security patterns:** <native types/schemas, API/error/auth boundary, relevant vetted pattern>
- **Validation / Deployment / Recovery:** <actual commands and proposed environment/deploy/recovery process>

No recipe is assumed for a new project. A proposed first stack requires this package's owner approval; call it verified only after suitable evidence. Preserve an adequate existing stack and justify a mismatch before fresh evaluation.

## Package review

Review this document together with the product specification, including unresolved decisions, case IDs, quality profile, recipe, phases, and gates. Approval evidence and exact hashes are recorded in the run record, not by editing this saved plan.
