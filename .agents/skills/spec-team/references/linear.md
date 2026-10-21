# Linear and delivery contract

Relay is the sole writer for Linear project setup, milestones, issues, relationships, status, and progress comments. Roles return facts and evidence to Relay; an assignee ID is a real configured account ID, separate from the agent role. Lens is read-only and does not mark Done.

## Project setup

Resolve the actual workspace, team, project, owner/lead accounts, and status mapping from authenticated tools. Search and read before creating; reuse existing IDs and links. Write only after the complete spec/plan package has current approval receipts and prerequisites are available. Read back each created or changed resource before reporting success. A timeout is ambiguous: reconcile with live search before retrying. Missing access means prepare clearly labeled local drafts and resolve setup; do not claim remote resources or dispatch as though live tracking exists.

Use one bounded delivery project with only the few meaningful approved milestones. The overview states goal, scope/non-goals, approved spec/plan revision, milestones, current phase, and important risks. Link source documents as project resources; while unpublished, use labeled local paths or a summary, never an invented URL. Reuse the current project when continuing a run. Do not create projects per role, worktree, tiny feature, or case.

Linear sign-in may precede ticket creation. After approved issues are read back, put the relevant [environment preparation](environment.md) checklist in the first coherent implementation issue; split only substantial independently assignable setup. Record versions, sanitized results and concrete access blockers, never credentials or raw environment/log output. Required setup failures block dependent work; setup success alone does not make the issue Done.

Logical states are Backlog, Ready, In Progress, In Review, Awaiting Acceptance, and Done. During setup map them to the team's actual statuses; do not assume those names exist or change team-wide workflow. Several logical states may share a provider status; preserve the distinction in issue details/comments. Use native blocking relations where available and explain other dependencies and next actions.

Write status at meaningful events: work begins, a blocker appears, the complete delivery is ready for review, Lens gives a verdict, acceptance resolves, merge is verified, or cleanup needs attention. Avoid a comment per command/edit or an extra review ticket for small fixes. Relay's summary identifies phase/task, role, logical state, blocker, PR/review link, and next action. Done requires required review, selected acceptance, required checks, and verified merge. Cleanup is recorded separately; a cleanup failure cannot erase the fact of a verified merge, but overall completion stays incomplete.

## Ready issue contract

Use one issue for a coherent outcome. Every ready issue has these exact sections:

1. **Outcome and purpose** — concrete behavior delivered and why it matters.
2. **Specification references** — requirement IDs, approved spec/plan revision or commit, and applicable design/API/schema references.
3. **Context** — current behavior, verified paths/callers/consumers, reusable patterns, and planned paths clearly distinguished from existing ones.
4. **Scope and ownership** — in/out, responsible role, model/effort, owned files/shared resources, and explicit boundaries.
5. **Dependencies** — prerequisites, blocking issues, and required handoff inputs/contracts.
6. **Implementation checklist** — meaningful steps, not copied full plans or speculative code recipes.
7. **Acceptance criteria** — observable success/failure, relevant case IDs, edge cases, permissions, compatibility.
8. **Validation** — implementer checks and expected outcomes, phase checks, and behavior needing manual/hosted/device evidence.
9. **Documentation** — relevant API/schema/user/setup/operations updates only.
10. **Execution and handoff** — assigned worktree/branch/base commit when available, PR, actual checks, review/acceptance, remaining gates, merge and cleanup evidence.

A draft may retain unknowns, but it is not Ready while a consequential unknown prevents safe implementation. Workers inspect live issue content and approved source slices. If an issue conflicts with the package, Relay resolves it instead of silently changing scope. Link case and quality-profile IDs in these existing acceptance/validation sections; do not create an issue per case or another board.

Subissues are only for substantial separately assignable outcomes. Use clear dependencies and owner role; do not invent dates, estimates, accounts, status IDs, Linear IDs, or provider facts. Keep PR descriptions aligned with the repository template and installed implementation-skill delivery template, resolving that template at runtime rather than hardcoding a local path. Describe the problem/result, consequential choices, linked issues/specs, actual validation/environment, relevant risk, and remaining gates. Scale to the change and omit empty sections.
