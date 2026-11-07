# HomeBeacon access and policy implementation

Updated November 7, 2026.

## Delivered

- Operator sign-in, sign-out, basic profile, password change, and password recovery.
- Recovery uses a high-entropy single-use code supplied privately with operator access. It does not pretend to send email. Email delivery is not configured.
- Salted PBKDF2 password hashes, secure HTTP-only eight-hour cookies, same-origin writes, server-side throttling, signed sessions, and invalidation after password change.
- Privacy, terms, cookie policy, accessibility statement, and persistent cookie preferences.
- No analytics or advertising cookies. Both preference actions keep essential storage only.
- Public exercise uses fictional homes, separate from authenticated device observations.

## Accessibility

Target: WCAG 2.2 AA. Eight pages pass automated axe checks, including the authenticated profile. Automated axe checks cover login, exercise command center, reset password, privacy, terms, cookies, and accessibility pages. Results are in accessibility-audit.json. Property filtering and Escape-to-close dialogs are exercised in scripts/audit-ui.mjs. Desktop and mobile screenshots are captured. Focus styling, text status labels, native form controls, reduced motion, and a complete list alternative accompany the map.

Automated checks do not certify ADA compliance. Screen-reader testing, expanded zoom and device testing, and human review are still required. Legal pages are prototype drafts. Production needs legal review, a named operator, an approved public support contact, and an enforced retention schedule.

References:
- https://www.w3.org/WAI/WCAG22/quickref/
- https://www.ada.gov/resources/web-guidance/
- https://argus.build/ui (public Oracle component patterns, adapted independently)

## Private access

Initial operator password and recovery code are stored only in the ignored local .env. Password hashes, the signing secret, and the backend administration key are installed in encrypted Cloudflare settings. No credentials belong in tracked files or browser bundles.
