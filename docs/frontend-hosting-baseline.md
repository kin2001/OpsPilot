# Frontend hosting baseline

The frontend is a client-routed application. `public/_redirects` serves the application shell for invitation, recovery, and other client routes. `public/_headers` sets a restrictive document policy, disables referrers, and keeps responses private and uncached.

Invitation and password-recovery documents receive `Referrer-Policy: no-referrer` and `Cache-Control: private, no-store`. The same policies are set on Vite's local and preview responses so browser checks can exercise them before a static host is chosen.

The Content Security Policy allows the application itself and Supabase project endpoints. Before hosting, replace the Supabase wildcard in `connect-src` with the exact, authorized Auth/API origin and matching WebSocket origin. Do not add an origin until the project and redirect allowlist are verified. No hosted deployment target or production header enforcement has been verified by this change.
