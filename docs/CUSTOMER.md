# Customer role (module D)

Customers link a HomeBeacon at `/customer` with the serial and pairing code (or the QR link `/customer#claim=SERIAL.CODE`, where the code stays in the URL fragment and is removed from the address bar on load). They see status, conditions, operator messages marked customer-visible, and help status. Advisory only: no data, or data older than 15 minutes, shows "No recent signal", never normal. Nothing implies occupancy, safe entry or dispatch.

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
