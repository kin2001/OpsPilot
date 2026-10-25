# Visual and accessibility verification

POR-43 / approved R3 specification and plan, R1 slice 28A. This document describes the implementation and repeatable checks; it is not device, screen-reader, hosted or private-pilot acceptance. The owner selected independent Lens synthetic testing on 26 October 2026. Required actual manual/device observations remain pending.

## Reference mapping and data adaptations

Use all twelve native PNGs in `design-references/v2` with the matching routes below. The supplied `src/assets/opspilot-logo.png` is retained unchanged; organization identity never replaces it. Preserve the warm canvas, stone rail, cobalt actions, compact rules, record selection, page heading and content hierarchy. Reference counts, people, vehicles, appointment times and histories are illustrative; production views display authorized records and explicit unknown/empty/error states.

| Reference | Route | Composition and justified adaptations |
| --- | --- | --- |
| 01 Dashboard | `/` | Four totals, attention queue, availability chart, schedule and brief. Missing history stays unknown; planned dates have no invented appointment time. Chart has a text table for assistive technology. |
| 02 Requests | `/requests` | Search/filter inbox and selected request preview. Actual record IDs and authorized identities replace illustrative names; triage, images and history preserve existing permissions. |
| 03 Work orders | `/work-orders` | Four board lanes and table switch; existing drafts remain in the open-work grouping. Detail/actions are progressively disclosed and keep explicit review/release steps. |
| 04 Assets | `/assets` | Registry and selected preview. Images and meter/history fields appear only when recorded and authorized. Small screens use record cards and stacked forms. |
| 05 Maintenance | `/maintenance` | Calendar/Plans tabs, date agenda, recurring plan details. The existing month/day calendar follows stored local dates; it does not invent the reference's hourly appointments. |
| 06 Inspections | `/inspections` | Counts, inspection/template views, assignment results and checklist details. Unknown outcomes stay unverified. Long checklist/history labels wrap. |
| 07 Inventory | `/inventory` | Exact balances, catalog filters, locations and immutable movement history. Counts describe loaded pages/stock locations; location management and stock correction remain explicit existing actions. |
| 08 Team | `/team` | Workload, assignments and member records. Authorized IDs replace unavailable personal profiles; leave, phone numbers and capacity percentages are not invented. |
| 09 Reports | `/reports` | Deterministic filters, metrics/charts, source rows and export. Real report categories and date bounds replace illustrative totals; unavailable cost/history remains explicit. |
| 10 Assistant | `/assistant` | Scoped conversation history, thread, facts/source references, reviewed drafts and composer. No canned operational answer is rendered as a fact; disabled/unavailable AI preserves manual continuity. |
| 11 Notifications | `/notifications` | Category filters, delivered-event inbox and selected source details. Empty inboxes remain empty; source access is checked rather than filled with reference records. |
| 12 Settings | `/settings` | General settings, authorized sites and account links. The page exposes implemented policy/timezone/currency fields; illustrative business contacts, date-format and logo-upload controls are not invented. |

The shared navigation follows the reference order, with existing role filtering. At mobile widths it is an explicitly named modal region: focus enters its close action after visibility commits (including reduced motion), stays within its controls, Escape closes it and focus returns to the opener. Closed navigation is inert and hidden. Resizing restores desktop navigation. The skip link targets a focusable main region. Maintenance, inspection and notification tabs share arrow/Home/End navigation with one selected tab stop. Notification tabs remain mounted while filtered results reload so automatic activation preserves focus. Assistant stacks its columns earlier to keep its composer usable at tablet widths; shared form controls can shrink within their columns.

## Repeatable synthetic checks

`tests/e2e/visual-accessibility.spec.ts` exercises all twelve pages at 320, 375, 768, 1024, 1280, 1440 and 1920 CSS pixels, rejects document overflow and clipped form controls, checks the brand and captures native-size (1672 x 941), desktop and mobile screenshots. Fixtures extend existing isolated workspace data with explicit read results and settled empty states; no live provider or private data is used. Existing module browser suites additionally cover populated maintenance, inspection, inventory, reporting and Assistant journeys, private images, errors and authorization.

The 200%/400% synthetic checks use the effective layout widths of a 1280px viewport (640px/320px). They prove equivalent reflow, **not actual browser UI zoom**. CSS `zoom` is not used as a substitute because it does not update media queries like browser zoom. Actual browser zoom remains an observation gate.

The suite also checks reduced-motion rendering, keyboard navigation/focus containment/return, skip-link focus, tab semantics, long form input and an announced server error with the draft preserved. Existing authentication/onboarding/security forms retain their brand and linked labels/errors. Production chart data has accessible text/table equivalents. A wide operational table may scroll inside its labeled local container where two-dimensional relationships are essential; document-level overflow and clipped form controls are not accepted. These assertions are regression checks, not a complete WCAG conformance audit.

Run with the approved Node/npm and existing lockfile:

```text
npm run typecheck
npm run lint
npm test -- --maxWorkers=1
npm run build
npm run test:e2e -- tests/e2e/visual-accessibility.spec.ts
```

The Linux PR-event `verify` workflow remains the required full-service gate, including populated forward upgrade, reset/native types, database authorization, Edge readiness, service/browser integration, recovery, schema comparison and unconditional owned cleanup. A skipped stage is not a pass. This slice does not change backend, CI scripts or dependencies. The existing Windows CRLF-sensitive inventory SQL text assertion is retained as a failure rather than weakened for this UI delivery; final Linux CI must establish the complete result.

## Evidence and remaining gates

Exact candidate/base/tree, commands, browser versions, screenshots, independent code review, separate selected synthetic acceptance and final CI results belong in the retained POR-43 report and linked PR. Initial regressions reproduced offscreen keyboard navigation, Assistant overflow at 768px, missing tab arrow behavior and incorrect reference navigation order before their fixes. Local logs retain fixture/setup failures and the initial unconstrained unit-run memory failure; the one-worker unit run distinguishes the unchanged SQL assertion from UI regressions.

The following observations are **unverified and required before overall acceptance**:

- Actual current/previous supported Chrome, Edge, Firefox and Safari coverage beyond the versions actually exercised.
- Actual browser UI 200%/400% zoom, pointer/touch use and human visual/contrast/focus review.
- Desktop NVDA with Chrome/Firefox, Android Chrome with TalkBack, and iPhone Safari with VoiceOver.
- Hosted/private-pilot, qualified human security/safety/business/recovery and field/device gates assigned to the parent readiness phase.

Synthetic review does not certify accessibility or satisfy required human/device evidence. Keep the PR unmerged and the issue open while POR-43's required evidence is missing. No provider enablement, spending, deployment or private admission follows from these checks.
