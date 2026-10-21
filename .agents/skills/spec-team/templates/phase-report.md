# Phase report: <phase>

## Delivery identity

- **Approved phase and issue IDs:** <from approved plan/actual tracker>
- **Repository / controller root / run:** <observed identities>
- **Candidate head / base SHA / integrated tree:** <exact snapshot>
- **Worktrees / owners:** <actual path, branch or detached state, writer, ownership status>

## Implementation and checks

| Check | Command / source | Environment and snapshot | Result | Evidence |
| --- | --- | --- | --- | --- |
| <check> | <actual command or provider check> | <environment/head/base/tree> | <pass/fail/unverified/N/A with reason> | <link/path> |

Record starting failures separately from regressions. Note changed files, documentation, migrations, and relevant compatibility/risk.

- **Environment preparation / reuse:** <actual worktree, recipe/input revisions, verified tools/services, sanitized smoke results and applicable ENV cases; separate recorded observations from current checks and retain unresolved access/secret-handling gates>

## Independent review

- **Lens verdict:** <PASS / CHANGES REQUIRED / INCOMPLETE>
- **Reviewed repository / head / base SHA / tree:** <actual snapshot>
- **Findings and resolution:** <evidence, severity, owner, affected recheck>
- **Unverified gates:** <what was unavailable>

## Phase acceptance

- **Selected method:** <manual / automated / pending>
- **Acceptance snapshot:** <repository/head/base SHA/tree>
- **Result:** <pending / pass / fail>
- **Owner evidence or Lens commands/scenarios:** <actual evidence>
- **Remaining required gates:** <environment-specific outstanding criteria>

## Case coverage

Record relevant approved case IDs, result, actual evidence, and environment. A placeholder starts unverified; a build or mock does not imply end-to-end, permission, persistence, recovery, UI, hosted, or device acceptance.

| ID / Requirement | Result | Evidence / Environment | Notes / Remaining gate |
| --- | --- | --- | --- |
| <CASE-01 / REQ-01> | <pass, fail, or unverified> | <actual path/command/environment> | <boundary or gap> |

## Project quality evidence

Link the approved quality-profile criteria/case IDs to evidence and the real environment. Required failure or missing evidence blocks acceptance. N/A requires its approved reason.

| Criterion / Case IDs | Result | Evidence / Environment | Notes / Gate |
| --- | --- | --- | --- |
| <profile item / IDs> | <pass, fail, unverified, or N/A with reason> | <source and environment> | <remaining issue> |

## Integration and cleanup

- **Required CI and protection:** <actual check source/name/snapshot/result and current-base protection; or unavailable>
- **PR snapshot:** <URL, head, base, base SHA>
- **Merge:** <pending/queued/unknown/failed/verified merged; actual provider evidence and commit>
- **Integrated tree readback:** <actual tree and comparison with accepted tree>
- **Cleanup:** <pending/preserved/complete/failed; exact path, registration, inventory, and evidence>
- **Attribution:** <primary Git author and coauthor trailer/linked author; actual UI observation if applicable>

A merge acknowledgement or queued request is not a verified merge. A verified merge does not by itself prove cleanup complete. Preserve dirty/unmerged work and protected paths.

## Delivery observations

- **Elapsed delivery time:** <observed or unavailable>
- **Equivalent failed attempts and revised diagnosis:** <actual attempts/reasons, or none observed>
- **Starting failures vs. regressions:** <specific evidence>
- **Findings and retained project-memory proposals:** <source/revision/last verified/recheck condition; Relay curates at exclusive handoff>
- **Usage/model observations:** <actual values or unavailable; never infer savings>
- **Other risk or recovery information:** <concise findings>

## Handoff and next action

- **Linear logical state / actual status:** <actual reference or local draft>
- **Next approved task/phase:** <actual dependency and owner>
- **Blocker / owner action required:** <specific current gate or none>

This report records phase evidence. It does not authorize unrelated work, turn unknowns into success, or replace the current tracker/provider state.
