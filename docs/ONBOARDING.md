# Safe Home box onboarding

Ayan's workstream, November 8, 2026. Implemented on `feat/device-onboarding`; see WORKLOG for deployment evidence. This replaces the interrupted design document with the actual contract. Mesh auto-enrollment remains a later phase.

## Customer journey

1. Scan the private card QR or visit `/customer` and choose **Add my box**.
2. Sign in or create an account. The card's serial and code stay in page memory while the account is created. The URL fragment is removed immediately; it is not sent to the server as a page URL or stored in browser storage.
3. Enter the serial and pairing code, optionally name the box and room, and enter its address. Contact sharing is an explicit choice. The camera scanner is optional; manual entry works without it.
4. A successful claim links one account to one box. The customer sees **Waiting for first report** until the server accepts data. The page checks every 10 seconds. Arrival in the website also depends on the device's reporting interval and network availability.
5. Manage the name, room and alert pause from the customer page. Unlink/remove revokes the owner's and shared household's access through that link. Pairing again requires an operator-issued replacement card; a used card cannot be replayed.

An address is matched through the existing address service. No address means an unlocated home, not an invented map pin. An established home's location cannot be silently moved by a new claim. Coordinates and registered address exposure follow the existing product contract; this release does not introduce a new location-privacy consent switch. A successful claim does not install firmware or connect Wi-Fi.

## Availability and conditions are different

Fleet availability has two states:

- **Active:** customer linked, box enabled and a recent server receipt exists.
- **Inactive:** disabled, not linked, unlinked, awaiting first report or silent. The reason is displayed.

The silence threshold is the greater of 15 minutes and `3 × expectedReportIntervalSeconds + 60 seconds`. A configured reporting interval must be 5–86400 seconds. The device's message polling interval is not used as a reporting promise. Server receipt time determines availability; replayed device timestamps cannot make a silent box appear current.

Availability never changes sensor severity. A connected controller with no environmental observations does not become a green safe home. Existing unknown, stale and latched-critical rules remain in charge of conditions.

## Inventory and private labels

Use the CLI, not a browser add-box screen. [CLI-ONBOARDING.md](CLI-ONBOARDING.md) documents commands, output permissions and recovery.

`POST /api/ops/fleet-batch` requires the administrator bearer credential and explicitly rejects ordinary operator/demo sessions, even when middleware has injected its internal administrator header. Count is 1–100. Each record has its own random device key, stored only as a hash, and begins without a home. The batch and all pairing records are committed in one transaction. A successful request creates inventory; retrying it creates more inventory. An ambiguous response requires inspection, not blind retry.

New inventory uses eight-character pairing codes. Their HMAC includes the site's session secret, serial and random salt. The eight-character serial body uses seven random characters plus a weighted checksum from `ABCDEFGHJKMNPQRSTUVWXYZ23456789` (31 characters). Legacy random serials and six-digit cards remain accepted. Inventory cards do not expire while unused; replacement cards expire after 30 days. Ten wrong code attempts lock a card. Claiming atomically consumes its hash and links the device; two simultaneous customers cannot both win.

The private CLI manifest holds the one-time device key and pairing code. Label HTML contains the pairing code/QR but never the device key. The outer sticker contains only the serial; the inner card contains the claim credentials. Files are exclusive-created, mode 600, in fresh mode-700 private directories outside the checkout or under ignored `.secrets/`. Raw responses are retained privately before label rendering, so a rendering failure does not lose a successfully issued key. No credentials go into console output, browser bundles, audit details or repository documentation.

## Operator fleet

`GET /api/ops/fleet` returns up to 500 boxes, their serial, availability/reason, last receipt, firmware version when reported, key creation/rotation time, home and customer link. Contact details appear only when the customer allowed contact sharing. Demo sessions see exercise inventory only. Live inventory never includes simulated boxes.

`POST /api/ops/fleet/:id/action` requires an operator/admin and a typed matching serial plus a short reason. Cookie writes require same origin. Actions are:

- Disable/enable reporting.
- Rotate the device key, returning the replacement once. The old key stops authenticating immediately. The replacement must be installed locally, never sent over device downlink.
- Reassign an unlinked box to an existing home in the same environment. Existing readings and incident history are retained under their original identities.
- Force unlink a customer, removing their access without deleting historical readings.
- Reissue a pairing code for an unlinked box, or set an inventory note through the API.

The UI exposes the five requested maintenance actions. Replacement-card issuance remains in the administrator/API workflow. The fleet does not create boxes. Records predating serial issuance need a pairing card issued before typed-serial actions are available.

## Events and notifications

Accepted ingest records a deduplicated first-data event and a recovery event after a silence gap. Fleet reads and the existing scheduled data refresh detect silent linked boxes and record one warning per last-receipt interval. This is not a continuous connection or proof of a power outage. A scheduler outage can delay the stored warning; the displayed state is still derived from time at read.

Rejected device keys remain anonymous hourly aggregate counts in the existing audit log. They are not attributed to guessed device IDs, and raw keys, request bodies and addresses are not logged.

Customer **Pause alerts** suppresses the linked box's customer email notifications and queued household device/weather alerts, including checks immediately before sending. It does not hide status, clear incidents or suppress operator evidence. This release does not add new outgoing test emails. Existing email configuration and verification rules remain intact.

## Server contracts

- `POST /api/customer/claim`: serial, code, consent, optional contact name/nickname/address. Contact name is required only when contact sharing is enabled.
- `GET /api/customer/devices`: existing customer-safe condition fields plus serial, room, first/last receipt, fleet availability and alert-pause time.
- `PATCH /api/customer/devices/:linkId` (also `?id=`): nickname, room, `notificationsPausedUntil` (null to resume, at most 30 days ahead). Ownership is checked on the active link.
- `DELETE /api/customer/devices/:linkId` (also `?id=`): unlink. The database transaction invalidates the used card and serializes against claim/operator changes.
- Ingest may carry `X-Firmware-Version` (1–64 safe version characters). Unknown versions remain unknown.

Household viewers retain read-only access through active authorized links. Their page reads do not write risk caches, message acknowledgements or fleet events. Removing the underlying customer link revokes shared access.

## Uno Q handoff

The registered **Uno Q hub** and its UT Dallas home already existed. This work reused its privately saved key. Real CPU temperature, memory, load, uptime and Wi-Fi observations now upload through the connected Mac's ADB/USB bridge. The earlier controller-only duplicate was disabled after fresh hub receipts were verified; its history remains.

The published 0.1.0 agent passed its own self-test on the Q and was staged under the `arduino` user's private configuration/data directories. The device key is mode 600 on the board. The root installer could not run because sudo needs a password. No system service was started, and Wi-Fi is down. The Mac bridge currently provides the live connection. This is not a verified independent wireless deployment, battery endurance result, or physical water/fire sensor test. The separate unfinished 0.2.0 agent-parity worktree was not merged or installed.

The Q's pairing card is saved privately with the setup artifacts. No customer account was fabricated or linked; until its owner claims it, the fleet correctly says not linked even though reports arrive.

## Verification and remaining work

Backend integration tests use an isolated MongoDB replica set and exercise batch creation, claim races, first data, silence/recovery, settings, unlink/reissue, authorization and key rotation. Customer and fleet browser checks use fixture APIs and are identified as such in the review documents. QR tests decode generated symbols with an independent decoder, including the actual printable SVG.

See [ONBOARDING_SECURITY.md](ONBOARDING_SECURITY.md), [ONBOARDING_PRODUCT.md](ONBOARDING_PRODUCT.md) and WORKLOG for current results and release checks. No test inventory or customer accounts are seeded into production. Enrollment through the mesh, customer Wi-Fi provisioning, autonomous hardware startup and physical endurance/calibration remain separate work.
