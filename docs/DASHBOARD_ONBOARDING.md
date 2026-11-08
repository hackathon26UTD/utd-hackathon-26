# Dashboard and repeatable box rollout

Ayan workstream, November 8, 2026. See WORKLOG for release status.

## One entry point

The homepage's primary action is **Dashboard**, linked to `/dashboard`. `/portal` remains compatible.

- Signed-out visitors go to `/signup`, with Argus Sign up / Sign in tabs.
- Public signup creates a customer account and opens `/customer#add-device`.
- Existing customers sign in and open `/customer`.
- Verified operator accounts open `/command-center` with production values. The existing Review return link is allowlisted.
- Shared demo accounts open `/simulations`. They never become operators.

`GET /api/access` reports only authenticated role and a fixed local destination. `POST /api/access` accepts `action: signup|login`. Login reuses the established operator and customer password/session handlers. Operator rejection falls back to customer credentials only on 401; throttling and provider failures are not bypassed. There is no public email-to-role lookup, role picker or public operator signup. A supplied role is ignored. New account registration does not pair devices implicitly.

A successful shared sign-in clears the other account cookie. Session types remain cryptographically separate, HTTP-only and credential-generation-bound. Old customer login/register routes remain compatible. QR fragments stay in memory on the customer page through sign-in and are removed from the address bar; passwords and pairing codes are not placed in browser storage. An explicit legacy operator switch link still allows switching out of an existing demo/customer session.

## Repeat this process for every batch

1. **Create inventory once.** Run `npm run hb -- devices provision --count 10 --prefix pilot --dry-run`, review the plan, then the same command with `--yes` instead of `--dry-run`. Use only the private administrator environment. Batches support 1–100 boxes. See [CLI-ONBOARDING.md](CLI-ONBOARDING.md) for headers, labels and private output recovery.
2. **Install the right key.** Transfer only that device's key to its matching firmware/agent. Put its serial on the box and its private pairing card inside. Never install the administrator key or another box's credentials. Power/connect the physical device and confirm accepted reports, not merely a successful flash.
3. **Customer connects the box.** Dashboard → Sign up or Sign in → Add my box. Scan the QR, or enter serial and pairing code. Supply the installation address for a mapped home. Optional contact sharing remains a separate choice. An already registered home cannot be silently moved by a claim.
4. **Observe first data.** The customer gets a waiting state until real reports arrive. Pairing alone does not invent power, Wi-Fi, location or sensor values. The same device record becomes linked and active when enabled and reporting.
5. **Operator verifies.** Dashboard → live map / Devices / Fleet. The live map polls roughly every four seconds; customer and visible Fleet views refresh every ten seconds, plus network time. Fleet refresh pauses during management forms or focused table interaction. Hidden tabs do not poll. Temporary Fleet errors retry; unauthorized responses require sign-in/manual reopening.
6. **Retire or recover deliberately.** Use existing confirmed operator disable/rotate/force-unlink actions. Record serial, deployment location, firmware version and acceptance time in the team's inventory. Keep credentials private. A replaced firmware key is not considered installed until reports resume.

Batch creation is not an idempotent retry: inspect the private manifest and Fleet after an ambiguous response before issuing another batch. Do not regenerate identities for an existing box. The Uno Q hub already has an identity and private pairing card; reuse them.

## Acceptance and limits

The repeatable regression in `test/dashboard-access.test.js` provisions two independent boxes into a disposable database, signs up their separate owners, pairs each, accepts fresh observations and checks customer isolation plus incremental operator data and active Fleet state. Other checks cover wrong/disabled credentials, cookie separation, demo limits, role injection, throttling, CSRF and redirect allowlisting. Browser tests cover the common entry, QR continuity, mobile layout and polling without losing maintenance drafts. These are local fixtures, never fake production homes or reports.

Current views are bounded to 500 devices and batch creation to 100. This is a repeatable hackathon/pilot rollout, not a measured nationwide capacity claim. Pagination, tenancy, invite-based operator administration, sustained load tests and device enrollment automation require further work before a larger service rollout. Operator access is explicitly provisioned by the project administrator, never inferred from an email domain or checkbox.

The Q currently uses a Mac-assisted USB uplink. That uploader has stopped on intermittent unconfirmed responses; diagnostics and current runtime evidence belong in WORKLOG and [UNOQ_PRODUCTION.md](UNOQ_PRODUCTION.md). Autonomous Wi-Fi, system-service setup, physical sensor calibration and battery endurance remain independent hardware acceptance steps.
