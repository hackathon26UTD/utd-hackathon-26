# Customer role (module D)

Customers create their profile at `/signup`, then choose **Add device** at `/customer` and enter their street address plus the serial and pairing code (or the QR link `/customer#claim=SERIAL.CODE`, where the code stays in the URL fragment and is removed from the address bar on load). They see status, conditions, operator messages marked customer-visible, and help status. Advisory only: no data, or data older than 15 minutes, shows "No recent signal", never normal. Nothing implies occupancy, safe entry or dispatch.

## Credentials
- Customer cookie `__Host-homebeacon_customer`, 8 h, signed with a key derived from `SESSION_SECRET` plus a customer label. `readSession` (operator, demo) never accepts it. Helpers in `src/operator-session.js`: `issueCustomerSession`, `readCustomerSession(request, env, db?)`, `customerCookie`. A password change (`customer_accounts.passwordChangedAt`) revokes older sessions.
- Middleware (`functions/api/_middleware.js`): public list plus customer register, login, `GET me`; device-key pass-through for ingest, `/api/device/messages`, `/api/device/logs`; every other `/api/customer/*` path has `Authorization` stripped and the handler checks the cookie; then admin key; then operator session (admin injected); demo may only GET the listed read paths.

## Endpoints
Customer (same-origin required on writes, 429 after 8 attempts per IP or 5 per serial in 15 min): `POST register`, `POST login`, `POST logout`, `GET me`, `POST claim`, `GET devices`, `DELETE devices?id=<linkId>`, `POST messages?id=<linkId>` with `{messageId}`. Ids are customer link ids, not device ids; foreign ids return 404. Failures for bad serial, bad code, or taken email with wrong password all say "Those details do not match an available device."

Operator (admin key or operator session, demo refused):
- `POST /api/ops/pairing {device_id}` issues serial and code once (reissue keeps the serial, rotates the code; 409 while linked). `GET ?device_id=` shows serial and link state without the code. `DELETE ?device_id=` releases a linked device.
- `POST /api/ops/help-status {device_id,status,note}`; `GET ?device_id=` returns status and history. Status is `none|review_queued|follow_up_assigned|help_on_the_way|resolved`. Humans only. The note (140 chars) is shown to the customer, so write it for them.

## Data
`device_pairing`, `customer_accounts`, `customer_links`, `device_help` as in SYSTEM_SPEC section 6. Pairing codes are stored salted and hashed, lock after 10 wrong tries until reissued, and expire after 30 days or on claim. Unlink deletes the contact name. Audit actor ids for customers are a hash of the email.

## Dependencies on other modules (all optional at runtime)
`src/risk/load.js` `loadRisk`, `src/risk/customer.js` `customerView`, `src/live.js` `customerMessages`, `markCustomerSeen`, `writeAudit`. If missing, customers see "No recent signal", no messages, and audit entries go straight to `audit_log`.

Tests: `node --test test/customer.test.js`.


## November 8 registration flow

Account creation no longer needs a device. The existing combined registration API remains compatible, but the website sends profile fields first. A QR fragment survives signup/sign-in in page memory and fills Add device; it is never sent to an address provider. Customers can also type the serial and code. Contact permission stays optional. Customer refresh is 10 seconds; the operator polls roughly every 4 seconds, including newly linked devices even without a new sensor reading. This is a refresh target, not a network-delivery guarantee. No readings are synthesized on registration.

Add device asks for a full lower-48 street address. After verifying the code, the server sends only the address to the U.S. Census Geocoder, requires one match, and stores an approximate address-range location. No match or provider failure leaves the pairing code available. Pair consumption, location assignment, customer link and claim audit commit together in an ordinary-collection MongoDB transaction. Atlas supports these transactions; local development and customer tests now use a one-node replica set. `TEST_CUSTOMER_MONGODB_URI`, when supplied, must also be a replica set; the general CI standalone database is not reused for these tests.

For an unbound device, registration creates its first home association. An existing home ID is preserved to retain ingestion/incident history. A supplied address over 250 meters from that home's coordinate is rejected for installer review; this tolerance accommodates approximate geocoding and is not an address verification claim. Shared homes are never moved by a customer claim.

Registered addresses are protected operator data. Google Street View is requested through the authenticated server image endpoint only when a Google key is configured. The nearby photo can be old or show another building; it never proves present conditions. Existing static-map operation tooling is preserved. No Google key was available during this work, so photo requests were tested with a provider stub, not live imagery. [Google Street View documentation](https://developers.google.com/maps/documentation/streetview/metadata).

## Personal assistants and self-built devices (November 8)

Customers can register up to five self-built boxes from the account page, using their address and current password. Registration issues a private hardware key once, adds an ordinary device/home/link transaction, and leaves readings unknown until measured telemetry arrives. Operator detail labels these boxes as self-built and unverified. The original pairing flow remains available.

The same page has personal OAuth MCP connections, optional encrypted NVIDIA key storage/questions, key replacement and email changes. New endpoints are `/api/customer/build`, `/api/customer/connections`, `/api/customer/assistant` and `/api/customer/account`. Existing cookie isolation and same-origin writes still apply. MCP is outside the customer-cookie API and uses its own scoped bearer tokens. See [ASSISTANT_CONNECTIONS.md](ASSISTANT_CONNECTIONS.md) for contracts, access boundaries and tests. The public guide is `/build`.

## Household sharing

Customers can create a named household, choose their live linked devices, and invite an email as a read-only viewer or an email-only member. Private links are copied, not emailed. The addressed signed-in account must explicitly accept. Owners can revoke access; members can leave. Shared reports refresh about every ten seconds without granting device management or operator access. Official weather and regional headlines are separate context. Email delivery remains disabled at Ayan’s request. See [HOUSEHOLDS.md](HOUSEHOLDS.md) and [HOUSEHOLD_CONTEXT_ALERTS.md](HOUSEHOLD_CONTEXT_ALERTS.md). Account email changes end existing household shares; devices stay linked.

## Customer enclosure overview (local feature branch)

The signed-in customer page adds an assembled enclosure viewer and selected-device summary, using the existing authenticated /api/customer/devices response. Last report time and server-approved conditions stay separate from the enclosure illustration. The lid is shown slightly open for presentation, not as a live sensor. Existing account, household and device management tools remain below.

/customer?preview=1 is a public design preview with fixed fictional readings and no customer/device API requests. No preview records are stored. Three.js and both user-supplied STL assets are served locally from the site; the viewer is loaded only for the signed-in overview or explicit preview. Drag, scroll, left/right arrows, Home/reset and pause/resume control the view. Reduced motion starts paused; reports remain accessible when WebGL fails. Source meshes: public/models/enclosure-base.stl and enclosure-lid.stl, provided by Saif November 8. Physical assembly clearance is not certified by this illustration.
