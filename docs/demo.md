# Isolated synthetic demo

This package uses the accepted application and native Auth, MFA, commands and RLS. All inputs in `demo/fixtures.json` are invented. The visible demo banner remains on every route. AI is disabled; no provider key, live-provider claim, private-data import, operational or safety approval is included. Sessions and edits persist in this local instance. This is a deployment preparation package; publishing and selecting any hosted target require separate authority. The current build deliberately supports only a local preview.

## Prepare an isolated local instance

Use a **dedicated disposable machine/VM and browser profile**, without private project credentials or data. A separate Git worktree alone does not isolate Docker containers, ports or browser storage. Do not run this against an existing `opspilot-t1` stack, CI job or private pilot. Check ports 5173, 54320–54324 are free and that Docker has no `supabase_*_opspilot-t1` containers. Stop on a collision; never reset someone else's instance. Use Node 24.15.x, npm 11.12.1, the committed lockfile and supported Docker/Supabase prerequisites. No new hosted project is needed.

From a clean clone on that dedicated machine:

```sh
npm ci
docker network create --driver bridge --opt com.docker.network.bridge.host_binding_ipv4=127.0.0.1 opspilot-synthetic-demo
npm exec --no -- supabase start --network-id opspilot-synthetic-demo
```

Supabase uses the existing `supabase/config.toml` (`opspilot-t1`, API `http://127.0.0.1:54321`). Inspect the newly created network and every published container port before proceeding; HostIp must be `127.0.0.1` or `::1`, matching the existing CI loopback recipe. A pre-existing network/name or a non-loopback port is a stop condition. Keep Docker access restricted to that machine. Do not link a hosted project or supply service/provider keys. Obtain **only this newly generated local instance's legacy `ANON_KEY` JWT** from `npm exec --no -- supabase status`; enter it as `DEMO_PUBLISHABLE_KEY` in the current shell. The build accepts only a token declaring local issuer `supabase-demo` and anonymous role; it rejects empty, malformed, hosted, service-role and opaque keys. The local service still verifies the token signature. Do not save status output, service keys, passwords or session URLs in source, screenshots, logs or exports. Use a new password per synthetic account, entered through the normal sign-up form; no fixed password is shipped.

In a second terminal on that same dedicated machine, start the native Edge functions using the checked-in **non-secret local-only** configuration. Keep this foreground process running throughout the walkthrough:

```sh
npm exec --no -- supabase functions serve --network-id opspilot-synthetic-demo --env-file demo/functions.env.example
```

The file sets `APP_ORIGIN=http://127.0.0.1:5173` and enables invitation delivery **only to this stack's local mail inbox**. It contains no provider key, SMTP credentials or AI enablement. Supabase supplies its own local service configuration; never copy service keys into this file. Without these settings, the invitation/export/upload handlers correctly reject the browser origin or report a disabled dependency. Before building or signing up, verify all four function preflights from the preview origin (this prints no tokens or bodies):

```sh
node --input-type=module -e "for (const name of ['organization-invite','attachment-upload','report-export','assistant']) { const r = await fetch('http://127.0.0.1:54321/functions/v1/' + name, {method:'OPTIONS',headers:{Origin:'http://127.0.0.1:5173'}}); if (r.status !== 204 || r.headers.get('access-control-allow-origin') !== 'http://127.0.0.1:5173') throw new Error('Local Edge readiness failed'); }"
```

Stop if readiness fails; do not bypass Origin checks or enable external email/provider services. Build and run the preview in the first terminal:

```sh
npm exec --no -- vite build --config demo/vite.config.ts
npm exec --no -- vite preview --config demo/vite.config.ts
```

Open `http://127.0.0.1:5173` in the dedicated browser profile and check the **SYNTHETIC DEMO** banner before entering anything. Sign up the three addresses in `demo/fixtures.json`, confirm each using the local mail inbox at `http://127.0.0.1:54324`, and enroll separate MFA factors through the app. Do not capture the confirmation links, MFA QR/secrets or browser storage. The native MFA and permission requirements remain enabled.

After the three confirmed signups, grant the two owners their bounded bootstrap allowances. On POSIX shells:

```sh
docker exec -i supabase_db_opspilot-t1 psql -U postgres -d postgres -v ON_ERROR_STOP=1 < demo/bootstrap.sql
```

On PowerShell:

```powershell
Get-Content -Raw demo/bootstrap.sql | docker exec -i supabase_db_opspilot-t1 psql -U postgres -d postgres -v ON_ERROR_STOP=1
```

The transactional SQL refuses extra users or existing organizations; a refusal is a stop condition, not permission to delete anything. It grants no memberships and imports no private facts. Before either owner creates a workspace, this step is repeatable. Then, as each owner, create their named workspace from the fixture file, with timezone Asia/Manila and currency PHP. In Alpha, invite `demo-tech@example.test` as technician and accept the invite in that account's separate browser session. Beta must have no Alpha membership. Use the ordinary UI to register the fixture asset in Alpha. Enter no real serial, registration, contact, photo or business data.

## Representative journey and expected observations

1. As the Alpha technician, submit the fixture request for DEMO-PUMP-01. As Alpha owner, convert it to the fixture work order, assign the technician and choose an eligible supervisor through the normal UI. The job begins in Draft. Repeating an acknowledged action must not duplicate the work.
2. Open the job as the owner and start it as the assigned technician. Before submitting, complete required tasks, enter invented repair notes, and declare the technician as the sole performer. Supply synthetic evidence if the workspace requires it, using a newly created image of a card saying SYNTHETIC TRAINING EVIDENCE. Submit the performer acknowledgment. The owner supervises/reviews but does not perform this repair, so separation-of-duty rules remain intact. Inspect history and the dashboard. Approval completes the repair; asset release remains a separate eligible action with current blocking checks. Do not interpret the fictional condition as a safety decision.
3. For the optional parts journey, create a second fixture job and keep it active. Add the fixture part and a synthetic stock location, receive `3` each, request/reserve/issue `2` each for that eligible active job, then return `1` unused unit. Observe the stock and job history (`2` on hand, `1` net issued). Use current versions and fresh requests for new actions; do not bypass lifecycle or replay guards. Receiving parts alone must not resume a blocked job.
4. Inspect Maintenance Plans, Inspections, Inventory, Reports and Assistant using current role permissions. Create optional training records through those native forms. Report an empty or unknown value truthfully. Export a report CSV containing only demo records and check cells and filenames before sharing. Assistant must show its disabled/manual continuation state; do not enable a provider to make the walkthrough look complete.
5. Sign in as Beta owner in a separate session. Alpha records and reports must be absent; an Alpha resource link must fail safely. As the technician, coordinator-only writes must be denied. Sign out and verify no workspace remains visible to the signed-out account. These are real current permission checks, not substitute screenshot data.

This recipe is deterministic in labels and inputs, with normal generated UUIDs/timestamps, passwords and MFA factors. Each new run uses a new isolated instance. No reset command is automated: retain any needed sanitized evidence and use the native local Supabase lifecycle **only after verifying ownership of that disposable stack**. Never apply a private backup here.

## Build, inspect and preview

With only the generated local public key in `DEMO_PUBLISHABLE_KEY`:

```sh
npm run typecheck
npm run lint
npm test
npm exec --no -- vite build --config demo/vite.config.ts
npm exec --no -- vite preview --config demo/vite.config.ts
```

Output is `.cache/demo-dist`, outside the ordinary production `dist`. The demo configuration ignores env files, overrides ambient `VITE_SUPABASE_*`, pins API access to the exact loopback address and adds a restrictive connection policy and persistent limitations banner. Its public key is intentionally browser-visible; never supply a service key. An empty key cannot authenticate. Inspect the built HTML for banner/policy and JS for the loopback target; check the browser Network panel before signing in. Private endpoints must be absent. Review source, build, logs, screenshots and CSV exports for private names, domains, records, keys and session/MFA artifacts. Keep captures away from authentication screens. Do not ship browser profiles, `.env` files, local storage, Docker volumes or status output with the artifact.

Development/HMR mode is deliberately rejected: this package previews the actual build under its production script policy. The automated isolation checks exercise key/target denial, actual build configuration overrides, fixture classification and banner/policy output. The dedicated browser check runs the built app under that policy with accepted synthetic route fixtures; the dedicated integration check submits the fixture asset/request through real Auth/MFA/RPC and verifies cross-tenant/role denial and replay. It also verifies that bootstrap refuses a populated stack without granting allowances. Existing full CI exercises the broader accepted native synthetic journeys and authorization matrix. These checks do not claim that all three fixed-email signups and the empty-instance SQL were manually walked, a deployed target, actual browser/device/AT coverage, live AI, hosted backup controls or private-pilot admission. Record those observations separately; the deferred POR-27/POR-43 and POR-28D gates remain open.
