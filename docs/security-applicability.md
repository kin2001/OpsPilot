# OpsPilot security applicability — T1 baseline

Target: applicable OWASP ASVS **5.0.0 Level 2**, as approved in the R2 package. This is an initial implementation/evidence worksheet, not certification or a completed assessment. Requirement IDs below were checked against the [official versioned English CSV](https://github.com/OWASP/ASVS/blob/v5.0.0/5.0/docs_en/OWASP_Application_Security_Verification_Standard_5.0.0_en.csv). Expand the worksheet for subsequent modules and the private-pilot review; nothing omitted is implicitly satisfied.

| ASVS 5.0.0 ID | Applicability and implementation boundary | Current validation / remaining evidence |
| --- | --- | --- |
| V2.2.2 | Server-side input validation: strict Edge schema, body bound, command allowlists, relational constraints | Unit input tests passed; real SQL/Edge validation pending isolated execution |
| V8.3.1 | Authoritative service authorization: active membership, tenant/role/resource checks, narrow RPC and RLS; UI is convenience | Real two-tenant/Auth/RPC/Storage tests written; no permission PASS yet |
| V8.4.1 | Cross-tenant operations: composite tenant foreign keys and current membership; exact request lookup has a minimal projection | Privileged cross-reference, wrong-user/role/tenant and revoked-member tests written; execution pending |
| V9.2.2 | Edge verifies the real Auth access token; application invitation is a distinct single-use confirmed-email operation | Actual runtime and recipient-email flow pending; no token-type assurance inferred from a mocked client |
| V13.3.2 | Private bootstrap/HMAC/receipts; least privilege on client tables/functions, no exposed server key | SQL grants require real negative checks; hosted secret storage/account/project identity unverified |
| V14.2.3 | No trackers/private-data export in T1; email only to intended verified recipient, token not returned from Edge | Browser implementation/privacy inspection pending Pixel; no private AI allowed |
| V14.3.2 | Edge responses use no-store; invite route must remove grant/session URL material before rendering | Edge unit headers and real runtime pending; browser/private-cache/header acceptance remains pending |
| V16.3.2 | Failed authorization observations must be retained in protected provider/security logs without sensitive data | Native Auth/API logs and required denied-command observation need verification; transactional success audit alone does not satisfy denied-event logging |

The approved current-membership checks also address immediate revocation even though ASVS V8.3.2 is formally Level 3; this is a required product behavior, not a claim of Level 3 conformance. Successful critical commands append allowlisted audit facts and request events; clients cannot edit/delete those records. HMAC key and raw invitation tokens never enter audit or receipts.

Trust boundaries are the browser/session, Auth token validation, PostgREST/RLS/RPC, privileged database helpers, private Storage, Edge, SMTP transport and CI. T1 has no production upload path; Storage defaults deny client writes/reads until the authorized file boundary is implemented in T2. A signed/public bearer file URL is not an acceptable substitute for current permission checks. AI, Cron, inventory contention, repair participant exclusions and operational release are later approved phase boundaries, not T1 pass claims.

Out of scope for the product: payment processing, native applications, direct machine control and autonomous AI actuation. Business safety, qualified security/privacy review, legal retention decisions and recovery ownership require named human decision owners before private pilot data. They cannot be supplied by agent assertions.

Known dependency finding: GHSA-vfj7-8cjw-p6xm affects the dev-only shadcn→glob→braces chain, with no patched release observed. Untrusted pattern/component generation is withheld; no clean audit is claimed. Local source/unit/build/browser smoke and actual hosted/SMTP/private-data/recovery evidence remain distinct.
