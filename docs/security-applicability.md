# OpsPilot security applicability

## Full V2 / POR-44 assessment boundary

The current backend evidence map is [readiness/backend-matrix.md](readiness/backend-matrix.md); recovery and intake decisions are [readiness/operational-controls.md](readiness/operational-controls.md). These supersede the historical T1-only descriptions below. Actual exact-candidate results belong in the delivery report; tests/source alone are not ASVS conformance or qualified security acceptance.

The target remains applicable **OWASP ASVS 5.0.0 Level 2**, including Level 1 requirements. Chapter and selected requirement identifiers were checked against the [official v5.0.0 CSV](https://github.com/OWASP/ASVS/blob/v5.0.0/5.0/docs_en/OWASP_Application_Security_Verification_Standard_5.0.0_en.csv). The following is an applicability routing worksheet for qualified review, not an assertion that every requirement in a chapter passes. Unmapped individual requirements remain unassessed; a human reviewer must complete per-requirement findings before private admission.

| Versioned requirement group | Application boundary and executable evidence | Open assessment / exclusion |
| --- | --- | --- |
| V1; V1.2.4, V1.3.6 | Typed RPC, bound parameters, fixed provider endpoints; safe React text; handler injection tests | Review every dynamic SQL anchor; LDAP/XPath/LaTeX/JNDI/memcache engines absent |
| V2; V2.2.2, V2.3.1–4, V2.4.1 | SQL constraints, strict Edge schemas, locked atomic commands and durable receipts; all SQL/service suites; `018_operational_limits.test.sql` | Business/safety reviewers assess limits and release procedures |
| V3; V3.2.2, V3.4.2–3 | Text rendering, fixed CORS, `public/_headers`, browser header tests | Actual host headers/TLS/redirects and browser/device evidence; SPA SDK bearer session requires XSS risk review |
| V4 | Narrow JSON APIs, bounded bodies/cursors/ranges, Edge token checks; module integration/handler tests | Actual gateway deployment/abuse controls; no GraphQL/SOAP endpoint |
| V5 | Private image magic/size/type/parent validation, current-JWT downloads; operational integration | PDF disabled; evidence/malware handling needs designated human policy |
| V6 | Native verified Auth, MFA, recipient-bound invitations; `core.test.ts` and native MFA integration | Authorized hosted SMTP, account recovery, final-owner recovery and identity policy |
| V7 | Session lifecycle/context clearing; current membership/Auth state rechecked, retained JWT tests | Sign-out does not promise immediate JWT invalidation; actual token expiry/hosted session settings |
| V8; V8.3.1, V8.4.1 | RLS/RPC deny matrix, least role/tenant/record access, performer/release races | Immediate membership revocation is additionally required by product; named human security review |
| V9; V9.2.2 | Edge delegates access-token validation to actual Auth, invalid/wrong-user tests | Hosted issuer/audience/key rotation and real expiry evidence |
| V10 | Supabase SDK/Auth controls any native identity exchange | No custom OAuth server or social provider configured; inspect actual Auth configuration before declaring narrower exclusions |
| V11 | Native crypto UUID/HMAC/digests; no custom cipher, no browser server key | Hosted key custody/rotation, encrypted backups and recovery access |
| V12 | Loopback-only synthetic CI; external app/provider requires HTTPS | Actual TLS/certificate/transport configuration and provider communication review |
| V13; V13.3.2 | Server-only credentials, pinned workflow actions/lock/runtime, script-free install; CI binding and cleanup checks | Hosted secrets, build/deploy target and dependency finding below |
| V14; V14.2.3, V14.3.2 | No private AI enablement/analytics, no-store Edge, protected transcript cleanup; assistant/Storage integration | Actual hosted privacy/retention approvals, browser caching and off-site backup expiry |
| V15 | Narrow shared contracts, additive migrations, independent review and native schema/upgrade checks | Human threat model and complete dependency/supply-chain review |
| V16; V16.3.2 | Safe fixed errors, protected authorization-denial log check, SQLSTATE-only diagnostics and self-check | Hosted log retention/access/monitoring and incident ownership |
| V17 | No WebRTC/media communication in this application | Not applicable while that capability remains absent |

**Findings retained for qualified disposition:** private pilot admission is blocked until actual named security/privacy, business/safety and recovery owners approve the destination and residual findings; hosted SMTP/TLS/configuration, encrypted off-site backup/7+4 retention, protected monitoring and an enforced intake-pause procedure remain unverified. POR-43 device/AT/zoom/manual and POR-27 live-provider observations remain deferred, not executed PASS. The existing shadcn development dependency advisory remains open; no dependency upgrade, automatic audit fix or clean-audit claim is included. A synthetic PASS cannot dispose of any of these findings.

Payment processing, native applications, direct machine control and autonomous AI actuation are outside the product. These exclusions do not exempt relevant browser/Auth/API/data controls. Keep application record/audit/receipt history until an authorized disposition decision; transcript and orphan cleanup use their explicit bounded policies. CI keeps dumps/bytes/credentials in memory or ephemeral job storage and uploads only the generated type contract.

## Historical baseline evidence

## POR-24 candidate additions and evidence boundary

The additive backend candidate enforces current tenant membership and required AAL2 before privileged replay; immutable repair participants and current hold scope govern review/release. Generic edits cannot establish Operational availability. Composite tenant/parent links, ready-only RLS and current-JWT Storage downloads protect validated private images. Direct client finalization/upload/cleanup privileges are denied. File reservations, dimensions, byte sizes, parent counts, tenant storage, roster, metric ranges and notification updates are bounded. Requested-work edits invalidate material submission; administrative edits retain explicit history. Meter corrections append linked records.

The focused SQL permission suite, real native-MFA/repair/contention/file service scenarios and upgrade/restore rehearsals are committed test intentions until actual isolated CI results exist. Local type/lint/unit/build checks do not verify RLS, Auth, Storage or transactional races. No ASVS PASS, security certification, Lens verdict or hosted/private acceptance is claimed. PDF/malware review, actual company evidence policy, qualified security/business/recovery owners and private-target deployment/backup/provider configuration gates remain unresolved human inputs before admission. The synthetic recovery scripts do not supply those inputs.

Target: applicable OWASP ASVS **5.0.0 Level 2**, as approved in the R2 package. This is an initial implementation/evidence worksheet, not certification or a completed assessment. Requirement IDs below were checked against the [official versioned English CSV](https://github.com/OWASP/ASVS/blob/v5.0.0/5.0/docs_en/OWASP_Application_Security_Verification_Standard_5.0.0_en.csv). Expand the worksheet for subsequent modules and the private-pilot review; nothing omitted is implicitly satisfied.

| ASVS 5.0.0 ID | Applicability and implementation boundary | Current validation / remaining evidence |
| --- | --- | --- |
| V2.2.2 | Server-side input validation: strict Edge schema, body bound, command allowlists, relational constraints | Unit input tests passed; real SQL/Edge validation passed on run39617925869 at1c95e7e |
| V8.3.1 | Authoritative service authorization: active membership, tenant/role/resource checks, narrow RPC and RLS; UI is convenience | Real two-tenant/Auth/RPC/Storage behavior passed on run39617925869; new current-Auth-state checks await execution |
| V8.4.1 | Cross-tenant operations: composite tenant foreign keys and current membership; exact request lookup has a minimal projection | Privileged cross-reference, wrong-user/role/tenant and revoked-member cases passed on run39617925869 |
| V9.2.2 | Edge verifies the real Auth access token; application invitation is a distinct single-use confirmed-email operation | Actual Deno Edge and captured recipient-owned Auth email/new-existing user acceptance passed on run39617925869; new invalid-token/current-Auth-state cases pending |
| V13.3.2 | Private bootstrap/HMAC/receipts; least privilege on client tables/functions, no exposed server key | Direct-write and private Storage negative checks passed on run39617925869; hosted secret storage/account/project identity unverified |
| V14.2.3 | No trackers/private-data export in T1; email only to intended verified recipient, token not returned from Edge | Browser implementation/privacy inspection pending Pixel; no private AI allowed |
| V14.3.2 | Edge responses use no-store; invite route must remove grant/session URL material before rendering | Edge unit headers and real runtime passed; invitation UI/private-cache/header acceptance remains pending |
| V16.3.2 | Failed authorization observations must be retained in protected provider/security logs without sensitive data | Protected denied-command log presence passed on run39617925869 without exporting raw logs; hosted retention/access/native Auth logging review remains pending |

The approved current-membership checks also address immediate revocation even though ASVS V8.3.2 is formally Level 3; this is a required product behavior, not a claim of Level 3 conformance. Successful critical commands append allowlisted audit facts and request events; clients cannot edit/delete those records. HMAC key and raw invitation tokens never enter audit or receipts.

Trust boundaries are the browser/session, Auth token validation, PostgREST/RLS/RPC, privileged database helpers, private Storage, Edge, SMTP transport and CI. T1 has no production upload path; Storage defaults deny client writes/reads until the authorized file boundary is implemented in T2. A signed/public bearer file URL is not an acceptable substitute for current permission checks. AI, Cron, inventory contention, repair participant exclusions and operational release are later approved phase boundaries, not T1 pass claims.

Out of scope for the product: payment processing, native applications, direct machine control and autonomous AI actuation. Business safety, qualified security/privacy review, legal retention decisions and recovery ownership require named human decision owners before private pilot data. They cannot be supplied by agent assertions.

Known dependency finding: GHSA-vfj7-8cjw-p6xm affects the dev-only shadcn→glob→braces chain, with no patched release observed. Untrusted pattern/component generation is withheld; no clean audit is claimed. Local source/unit/build/browser smoke and actual hosted/SMTP/private-data/recovery evidence remain distinct.


Current-user follow-up: Supabase access JWTs can remain valid until expiry after sign-out or deletion, and temporary bans do not automatically revoke existing sessions ([sign-out guarantees](https://supabase.com/docs/guides/auth/signout), [user administration](https://supabase.com/docs/guides/auth/managing-user-data)). This is separate from the product's immediate organization-membership revocation, already exercised in run39617925869. The candidate centralizes confirmed/nondeleted/nonbanned Auth user checks in a private, ungranted helper used by current membership, command actor and pending inviter validation. Actual retained-JWT ban/unconfirm/soft-delete, restoration and invalid/wrong-user Edge tests are written but unrun. This introduces no session registry or immediate sign-out JWT revocation claim. A genuinely expired signed-token boundary remains unverified.

Run39617925869 at1c95e7e passed migration/reset, native type generation, pgTAP8/8, real integration6/6, protected denial-log presence, Chromium1/1 and verified owned-resource absence. Its overall conclusion was failure solely at the expected missing committed native-types comparison. Native types were retrieved as the single-file artifact and copied exactly; the next candidate still needs its own actual service run. These observations are implementation evidence, not Lens acceptance or private-pilot approval.
