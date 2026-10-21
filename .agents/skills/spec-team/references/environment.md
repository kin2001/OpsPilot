# Product environment preparation

Prepare the product stack agreed in the approved plan. The `setup` action and offline bootstrap still install only the instruction kit and skill families. Use each stack's native tools; no universal product installer or credential manager.

## Sequence and ownership

1. During planning, inspect runtimes, package managers, manifests/lockfiles, services and authenticated access read-only. Atlas fills the technical plan's preparation section with observed versions, proposed commands, services, script policy, secret handling, verification and recovery. Unknowns remain unknown; inspection does not install or log in.
2. After current owner approval of the complete package, Relay authenticates to the correct Linear workspace as needed, creates/reuses approved issues and reads them back. Reuse valid connector sessions. No product install against local draft tickets or an unapproved plan.
3. Relay assigns preparation to Pixel for frontend or Forge for backend/shared tooling, with one writer per dependency directory and explicit shared-resource ownership. Put it in the first relevant coherent issue's checklist; split only a substantial independent outcome. No mandatory extra phase, role, command or acceptance gate.
4. The implementer prepares its actual worktree using the approved recipe and returns sanitized observations and smoke-check evidence. Relay alone updates the retained local record and Linear. Dependent feature work waits for required checks; unrelated authorized work may continue. Lens verifies relevant evidence in the existing combined review and selected phase acceptance.

## Installation and readiness

Before an install, verify runtime/package-manager compatibility, manifest/lockfile consistency, OS/architecture, working directory, disk space, permissions and required services. An executable or dependency folder existing is insufficient. Reuse compatible installations after the recipe's checks; never blanket reinstall on resume. Reuse caches through supported commands, but do not share mutable dependency directories across active writers or link worktrees' installed directories together.

Use the selected stack's package manager and lockfile behavior. For a fresh product, create minimal approved manifests/lockfile in the assigned checklist. Later reproducible installs use supported locked/frozen mode. Preserve locks and user configuration; reconcile mismatches without deleting locks, choosing arbitrary latest versions, forcing upgrades or disabling integrity/TLS checks. Material stack/version/security-policy changes require revised package approval through `change`; routine repairs already in the approved recipe do not.

Check commands' actual effects and installed-version support. For example, `npm ci` requires a matching existing lockfile and removes existing `node_modules`; it is not a presence check. Specify necessary allowed install-time scripts, review unexpected hooks, and avoid broad script permissions to bypass failures. Use the minimum required environment without unrelated credential variables. This reduces exposure but does not sandbox a process with access to user files or credential stores; withhold actions whose required hard boundary is unavailable.

Verify actual resolution, tool versions, configuration names, isolated local service health and recipe smoke/build checks. No production migrations, paid provisioning, deployment, global runtime replacement or administrator/system changes are implied; obtain specific authorization when outside approved scope. Failed/partial installs and unavailable required checks block dependent work. Preserve pre-existing files and failure evidence, diagnose disk/network/locked-file/platform errors, then retry safely under the existing bounded diagnosis policy. Do not promise rollback of arbitrary install scripts or external effects.

## Authentication and local secrets

Reuse authenticated connectors and supported CLI sessions through official APIs/commands. Agents acting for the same local user reuse that user's supported tool sessions; do not require a separate login per agent. Independent human contributors authenticate with their own accounts. Before service writes, verify required account, organization/project, environment and permissions without printing tokens. A valid login can target the wrong resource. Use supported refresh within authority; expiry, revocation, MFA, SSO or missing scopes may require one focused owner action. Never grant broader scopes automatically or infer permanent access from old evidence. Each desktop host verifies its own sessions.

Prefer native credentials backed by the OS or an approved existing secret manager. If a tool reports plaintext fallback or protection cannot be established, report it and withhold credential persistence until a safe supported method or explicit owner decision is available. Never export browser cookies, copy tokens between worktrees/apps, create a generic login/token file, or put credentials in arguments, remotes, tickets, memory, receipts or reports. Interactive login may update user-scoped tool storage; that specific action does not authorize the kit installer to change global settings.

Commit reproducibility requirements, manifests, locks and variable-name examples with empty or unmistakably fake values. If the approved application requires a secret file, use its supported location (for example `.env.local`), preserve existing values, restrict access to the intended local user, and verify the exact path is ignored and untracked before writing. Check build/container/package/archive exclusions and public client-bundle exposure separately; Git ignores do not control those outputs. Never put server credentials into browser-exposed variables. Prefer direct owner entry through the appropriate secure tool instead of chat. Redact logs at collection; exclude secrets from prompts, screenshots and attachments. Each contributor supplies their own credentials; installation and installed-copy bootstrap never carry consumer state or credentials.

If a credential is tracked, historically committed or otherwise exposed, stop affected publication/use, arrange revocation/rotation, and reconcile tracking/history/artifacts with the owner. An ignore rule or local deletion does not revoke a secret or remove earlier copies. Never rewrite shared history automatically. Before worktree cleanup, inventory needed ignored configuration and retain it in approved local storage without placing secrets in Git snapshots or kit bundles.

## Local observations and resume

Relay may create ignored `.spec-team/local/environment.json` in the canonical retained controller root from [the inert template](../templates/environment.json), during authorized preparation. It is advisory, never a credential store, approval or readiness authority. No global `ready` flag. Preserve unrelated files; write a complete temporary sibling and replace after success.

Use only the template's top-level fields. `input_sha256` maps repository-relative non-secret manifests/lockfiles to SHA-256; never hash secret files. `tools` entries contain `{name, version}`; `services` contain `{provider, account_ref, project_ref, environment, auth_method, status, checked_at}`; `checks` contain `{name, status, evidence_ref}`. Status is `pass`, `fail` or `unverified`; evidence references point only to sanitized local reports. Use actual observations/times and nulls or empty lists for unknowns. Never store raw output, environment dumps, connection strings, tokens or executable commands. Commands remain in the approved recipe.

On `resume`, recheck repository/worktree, approved recipe revision, manifest/lockfile fingerprints, tool versions and relevant live service identity/permissions/environment. Reuse healthy dependencies and sessions. Changed inputs, new worktree, partial install, unavailable services or stale evidence require affected checks again. Handoff retains metadata at the controller root; the destination verifies its own access without copying credentials. `status` reports observations, age and missing checks read-only; it cannot install, refresh, log in or promote an old result into current readiness.

## Cases to carry into the product plan

Select applicable cases before approval; assign owner, task, expected behavior/recovery and actual validation method. Definitions are not executed results.

| ID | Situation | Required result |
| --- | --- | --- |
| ENV-01 | Fresh clone or new contributor | Prepare approved stack after real ticket readback; use that user's necessary authentication and verify smoke checks. |
| ENV-02 | Healthy resume | Verify relevant inputs/session identity; reuse dependencies without blanket installs or repeated login. |
| ENV-03 | Wrong runtime, changed lock, missing manifests or partial install | Apply approved initialization/repair; preserve user state/locks and block unresolved dependent work. |
| ENV-04 | Offline registry, full disk, interruption, unsupported platform or locked files | Preserve files, record partial/failure state and diagnose before retry; no readiness claim. |
| ENV-05 | Valid login, wrong account/project or production target | Block affected writes until identity/environment/permissions match the approved destination. |
| ENV-06 | Expired/revoked session, MFA, SSO or missing scope | Use supported authorized refresh or request one focused owner action; preserve progress. |
| ENV-07 | Unsafe credential storage or secret exposure | Withhold unsafe persistence; arrange secure storage or rotation/artifact reconciliation, without automatic shared-history rewriting. |
| ENV-08 | Multiple workers/worktrees or handoff | One dependency-directory writer, owned ports/services/databases, per-worktree checks and native session reuse; no credential copying. |
| ENV-09 | Unexpected install hook or integrity failure | Apply approved sources/scripts and required isolation; block unsafe execution rather than bypass checks or expose unrelated secrets. |
| ENV-10 | Global/admin install, paid resource or production change | Explain the exact action and obtain authorization if outside approved scope; continue unrelated authorized work. |

## Command semantics sources

Check documentation for the chosen versions during planning. Baseline references: [npm ci](https://docs.npmjs.com/cli/commands/npm-ci/), [GitHub CLI credentials and fallback](https://cli.github.com/manual/gh_auth_login), [Git ignore limits](https://docs.github.com/en/get-started/git-basics/ignoring-files), and [credential-exposure recovery](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/removing-sensitive-data-from-a-repository). These are examples, not a required Node/GitHub stack.
