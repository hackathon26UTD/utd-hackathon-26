# Box onboarding and device management

Status: design, not built. Scope: boxes we build, customers who tie them to an account, operators who watch the fleet. Advisory only: missing data is unknown, and nothing here implies occupancy, safe entry, damage, coverage or dispatch.

## 0. Model in one paragraph

We build every box. It leaves the bench with a serial, a device record, a device key flashed into its secrets file, and a printed pairing card. The customer only ties the box to their account. A box is **active** when it is linked to a customer and reporting. Every other case is **inactive**, with one reason. There is no operator "add box" screen: operators bulk-create through the CLI or admin API only. State is derived on read from facts (link, disabled flag, last seen), never stored, so it cannot go stale.

We extend the existing `device_pairing`, `customer_links`, `devices`, `audit_log`, `takeAttempt` limiter, `#claim=SERIAL.CODE` fragment link, `npm run provision` and the `hb` CLI.

## 1. Inventory

**Command:** `hb devices provision --count N --prefix NAME [--type esp32|xiao-esp32s3-sense|unoq] [--home-less] [--note TEXT]`. Default and recommended is home-less: a box has no home until a customer links (the claim creates one). `--home-less` is kept as an explicit flag so the older synthetic-home behaviour of `npm run provision` stays reachable; without it the command refuses (decision: avoid creating fake homes for real inventory).

Per box the CLI calls one admin-key-only endpoint (`POST /api/ops/fleet-batch`, section 6) and receives, once:

| Item | Decision |
|---|---|
| Serial | `HB-XXXX-XXXC`: existing 31-character alphabet (no I, L, O, 0, 1), 7 random characters plus 1 check character (sum of weighted positions mod 31). Typo detection runs in the browser and CLI only. The server never rejects on checksum, because boxes issued earlier have 8 random characters. Serial is not a secret. |
| Device record | Name `{prefix}-{nnn}`, `fleet.batch`, `fleet.builtAt`, `fleet.builtBy`, no home, `disabled:false`. |
| Device key | `dk_` plus 32 random bytes, existing hashing. Returned once to the CLI. Written only to the box's `secrets*.h` (mode 600, existing git-ignore) and to an ignored manifest `work/inventory/<batch>.json` (mode 600, contains keys; directory `work/` is already git-ignored). Never printed, never logged. |
| Pairing code | **New v2 code: 8 characters from the same alphabet (about 40 bits)**, shown as `XXXX-XXXX`. Legacy 6-digit codes still verify. Stored as HMAC-SHA256 with a pepper derived from `SESSION_SECRET` (label `pairing`), not plain salted SHA-256, so a database-only leak cannot be brute-forced offline. Consequence: rotating `SESSION_SECRET` invalidates unclaimed codes; reissue them. |
| Expiry | Inventory codes have `expiresAt: null` (no expiry), because boxes sit on shelves and ship. Codes issued by reissue keep the existing 30-day expiry. `claimDevice` must treat `null` as "never expires" (today `new Date(null)` would read as expired). |
| Label sheet | `work/labels/<batch>/sheet.html` (print to PDF, one SVG label per box, git-ignored, deleted after printing is advised). |
| Audit | `device_lifecycle` event `built` plus an `audit_log` row `fleet.batch` with the batch id, count and actor. Contains no secrets. |

**QR payload decision:** one URL, `https://<site>/customer#claim=HB-7K3Q-9XMD.K4M7-XP2R` (matches the existing fragment contract). The fragment is never sent to servers or logs and is stripped from the address bar on load. Threat analysis: the QR reveals the secret code, so whoever holds the card can claim the box. That is the intended model (possession of the card equals ownership), but it means:
- The label is split in two. **Outer sticker** (on the case, visible): serial and a "scan the card inside" note, no code, no QR. **Pairing card** (in the box or sealed under a scratch layer): QR, serial, code in text. Support asks for the serial only, never the code.
- A claim consumes the code (hash deleted). A photo of a used card is worthless.
- Online guessing: 40 bits with 10 failures per serial (lock until reissue) and 5 attempts per serial or 8 per IP per 15 min. An attacker needs a real serial and gets about 10 guesses in 2^40. Unknown serials and wrong codes return the same text and timing class; no endpoint confirms a serial exists.
- Lockout can be used to annoy a known serial (denial of service). Accepted: a `pairing_locked` event surfaces it to operators, and reissue clears it.

## 2. Lifecycle

States are derived (`src/fleet.js` `deriveState(device, link, now)`):

```
                 link               reporting
 INACTIVE: not_linked ----> INACTIVE: awaiting_first_report ----> ACTIVE
      ^                                                          |   ^
      | customer unlink / force unlink                           v   | data resumes
      +-- INACTIVE: unlinked  <------ (any time) ------------ INACTIVE: silent (N min)
 INACTIVE: disabled   (disabled flag wins over every other reason)
```

| Reason | Meaning | Customer sees |
|---|---|---|
| `not_linked` | Built, never linked | not on their list |
| `awaiting_first_report` | Linked, no reading yet | "Waiting for your box to report" |
| `silent` | Linked, last seen older than the silent threshold | "No recent signal" (never green) |
| `disabled` | Operator disabled | "Paused by the team" |
| `unlinked` | Previously linked, now released (record kept) | not on their list |

Precedence: `disabled`, then `not_linked`/`unlinked`, then `awaiting_first_report`, then `silent`, else active. Operator list shows the reason text with the minutes, for example "silent for 47 min".

**What counts as reporting:** `lastSeen` within `silentAfter = max(15 min, 3 x expectedInterval + 60 s)`. `expectedInterval` comes from `desiredSettings.reportIntervalSeconds`, else `meta.reportIntervalSeconds`, else 60 s (normal Wi-Fi boxes batch about every 5 s; beacon/low-power mode can stretch to 1800 s, giving 5460 s). `pollAfterSeconds` (message polling) is not a report interval and is not used. `lastSeen` null is "never", not healthy. A relayed box (mesh) counts as seen when its own readings arrive, whichever box uploads them. Clock skew: use server `receivedAt`, never device timestamps.

A rejected-key post or a post that returned 409 (no home) updates `fleet.lastContactAt` (the box is alive but not accepted), never `lastSeen`.

## 3. Customer flow

1. **Sign up or in** (existing). A scanned `#claim=` fragment survives sign-in in page memory, as today. The fragment now accepts the v2 code (`[A-Z2-9]{4}-?[A-Z2-9]{4}`) as well as 6 digits.
2. **Add my box:** scan the card or type serial and code. Browser checks the serial checksum and offers "check the last character" on a mismatch. No server call happens until step 3, so there is no verify-only endpoint to probe.
3. **Confirm:** name (40), room (40, optional), consent choices (below), optional private location. One `POST /api/customer/claim` carries everything.
4. **Location (optional):** the customer may give an address now or later. The address is sent only to the existing geocoder step, stored as an approximate address-range location, and shown to operators only as coarse (rounded to about 1 km, or city) until the customer gives consent. Without an address the claim still succeeds and creates a home with `locationSource:"none"` so the box can ingest (`/api/beacon/ingest` returns 409 without a home). S must verify the homes collection and the 2dsphere index accept a home without `location`; if not, store a null-island-free sentinel via `location` omitted and a `homes.unlocated:true` flag.
5. **Consent choices (separate, default off):** (a) "Let the team contact me about this box" = existing `consent`; (b) "Share my exact address with the response team" = `locationConsent`; (c) "Email me when my box goes quiet" = `emailAlerts`. Contact name is required only with (a). No consent means no name stored, address coarse.
6. **Wi-Fi guidance** (honest, see gaps below).
7. **First-contact check:** the page polls `GET /api/customer/devices` every 10 s (existing refresh) and shows a live card: "Waiting for your box to report", then "Heard from your box 12 s ago". No readings are synthesised. After 10 min with no contact it shows the Wi-Fi checklist and the support serial.
8. **Manage:** rename/room, pause notifications (24 h, 7 d, until resumed; sets `notificationsPausedUntil`, affects email only), change consent, **unlink**, **transfer**, remove, factory-reset instructions.
   - **Unlink:** existing delete. Box returns to `inactive/unlinked`, record kept, contact name and nickname deleted, `consent` cleared. Readings stay with the device (operations history), detached from the customer: customer-visible history and messages disappear with the link. Private address (`meta.address`) is removed from the device and the home label is replaced with a generic one, unless an incident is open (then retained under operator rules and stated to the customer).
   - **Transfer:** unlink with `reissue:true`. The response shows a fresh serial plus new code **once** for the former owner to hand to the next one. Old card is already dead after the first claim.
   - **Remove:** same as unlink, plus the box disappears from the list immediately. There is no deletion of the device record.
   - **Factory reset:** instructions only. See gaps.

**Wi-Fi flow today (read from firmware):** Wi-Fi name and password are compile-time defines in `secrets.h` (`WIFI_SSID`, `WIFI_PASS`, generated by `npm run provision` from the bench `.env`). Box A and B try Wi-Fi every 30 s; with no Wi-Fi they run ESP-NOW mesh on the router channel. Hubs and the Uno Q agent use their own config (separate job). **Gaps, stated plainly:**
- G1: a customer cannot enter their own Wi-Fi without reflashing. Nothing shipped to a home works on a new network until this exists.
- G2: no access-point setup page, no BLE, no NVS-stored credentials, no serial `wifi` command.
- G3: no factory-reset button handling; "reset" today means reflash.
- G4: no firmware version is reported, so the fleet panel shows "unknown" for version until firmware sends the optional `X-Device-Firmware` header (additive, ignored if absent).
Interim for pilots: we flash the customer's network at handover (bench `.env`), or the customer uses a phone hotspot named as the bench defaults. Customer copy must say "Your installer sets up Wi-Fi" until G1 closes.

## 4. Automatic reactions

| Trigger | System does | Who is told |
|---|---|---|
| Customer links | Creates link and home, writes `linked`, shows waiting card | Customer: confirmation email if `emailAlerts` and mail configured. Operator: lifecycle event. |
| First data | Sets `link.firstReportAt`, event `first_report` | Customer: banner "Your box is reporting". |
| Goes silent | On the first sweep after `silentAfter`, event `silent`, state flips | Customer email only if `emailAlerts`, not paused, and silent for `silentAfter + 30 min`, max one per 24 h per box. Operator: event and chip. |
| Recovers | Event `recovered` | Customer banner only. |
| Unknown or disabled key posts | Upsert into `device_key_rejections` (hourly bucket) | Operator list "Rejected keys" with counts. Raw key is never stored. |
| Second account tries a claimed box | Claim fails with the uniform text; event `link_blocked` (rate-limited 1 per device per hour, actor is an email hash) | Operator event. Customer sees the uniform failure. |
| Customer unlinks | Section 3 | Customer confirmation; operator event. |
| Wrong codes reach 10 | Event `pairing_locked` | Operator. |

**Sweep:** there is no always-on scheduler in Pages Functions. The sweep (detect silent/recovered, write events once, send due emails) runs on (a) every operator fleet read, (b) every customer devices read for that customer's boxes, and (c) a call from `workers/data-refresh.js` if the owner approves editing it (not in these modules; flagged). Until (c), silent emails are delayed until someone loads a page. Idempotency: compare `fleet.reporting` to the derived value and update with a conditional write so concurrent sweeps emit one event. Stated honestly in the UI as "checked when a page loads".

Email delivery is currently disabled at the owner's request (see HOUSEHOLDS docs). Customer emails must go through the existing `sendEmail` gate and silently degrade to in-page banners.

## 5. Operator side

**Fleet panel** (new `ui/command/fleet.js`, opened from the existing toolbar through one hook line): every box we built, with state chip (active/inactive) and reason, search (serial, name, customer name), filter (state, reason, batch, consent, firmware), sort (last seen, state, key age, serial). Columns: serial, name, state + reason, linked customer name + consent flag (email shown only with consent), coarse location or home label (never the private address), last seen (relative and absolute), firmware (unknown if not reported), key age, power/battery when known else "unknown". Header counts: active, inactive by reason, rejected-key attempts last 24 h. Demo role sees exercise boxes read-only with no action buttons.

**Manage drawer** (device detail): every action asks for a reason (3 to 200 chars) and a typed serial for destructive ones; each writes `audit_log` and a `device_lifecycle` event.
- **Disable / enable:** sets `devices.disabled`; disabled keys are rejected by ingest (existing behaviour) and logged. Customer sees "Paused by the team".
- **Rotate key:** new key returned once to the caller only. Honest limitation: the box keeps using the old key until someone puts the new one on it, and the old key stops working immediately, so the box reads `silent` until then. Safe flow: (1) rotate through CLI (`hb devices provision rotate <id>`) which writes the key to the ignored manifest and a fresh `secrets.h`; (2) reflash over USB, or for a hub/Uno Q a person places the key in the agent's local env file; (3) fleet panel shows `recovered` when it reports. **The existing message and settings channel must not carry keys**: it is authenticated by the very key being replaced, stored in the database, and visible in operator and customer UIs. Rotate is therefore for compromise or lost-box cases, not routine. Grace period for the old key is not built (it would require changing `requireDevice` in `src/auth.js`, outside S).
- **Reassign home:** admin or operator, uses the existing device-home assignment; refused while linked to a customer (the customer's home is theirs); allowed for unlinked boxes.
- **Force unlink:** like customer unlink, with the same data policy, plus the operator reason. Customer is told on their next visit ("The team released this box"); email if consented.
- **Reissue pairing code:** new v2 code shown once (also usable for a box returned from a customer). Refused (409) while linked.
- **Lifecycle history:** `GET` of the last 100 events, newest first.
- **Operator note** (200 chars, no PII advice in the placeholder).

Operators never receive `customer_links.contactName` unless `consent`, nor `meta.address`, nor exact coordinates unless `locationConsent`. Known conflict to flag: existing operator endpoints (`/api/ops/location`, home label, map) already show registered addresses; this design does not change them and recommends gating them on `locationConsent` as a follow-up.

## 6. Data model and API

**Collections (additive):**
- `devices`: optional `fleet:{batch, builtAt, builtBy, firstSeenAt, lastContactAt, lastRejectedAt, keyIssuedAt, keyRotatedAt, firmware, reporting:"ok|silent|never", reportingChangedAt, silentNotifiedAt, operatorNote}`. Index `{ "fleet.batch":1, _id:1 }`.
- `device_pairing`: add `batch`, `codeVersion` (1 legacy, 2 HMAC), `lockedAt`, `issuedBy`, `reissueCount`; `expiresAt` may be null.
- `customer_links`: add `room`, `emailAlerts`, `locationConsent`, `notificationsPausedUntil`, `firstReportAt`.
- `device_lifecycle` (new): `{_id, deviceId, at, type, actor:{type,id}, reason?, details, exercise, expiresAt}`. Types: `built linked first_report silent recovered unlinked force_unlinked disabled enabled key_rotated code_reissued home_reassigned pairing_locked link_blocked`. Indexes `{deviceId:1, at:-1}`, `{at:-1}`, TTL on `expiresAt` = at + 730 days (longer than audit_log because it is the box's history; contains no PII beyond hashed actors).
- `device_key_rejections` (new): `{_id: hash(keyFp+ipHash+path+hour), keyFp (12 hex of SHA-256 of the presented key), ipHash (salted), path, reason:"unknown|disabled|missing", deviceId?, count, firstAt, lastAt, expiresAt}`. TTL 14 days. One upsert per bucket bounds write volume; global cap 2000 new buckets per day, then increment a single `overflow` counter.

**Endpoints** (all additive; JSON; operator = admin key or operator session; demo refused unless noted; writes need same-origin for cookie sessions):

Operator
- `GET /api/ops/fleet?state=inactive&reason=silent&q=HB-7K&sort=lastSeen&limit=100&cursor=` (demo may GET, exercise only)
  `{"asOf":"...","counts":{"active":12,"inactive":30,"byReason":{"not_linked":24,"silent":3,"disabled":1,"unlinked":2,"awaiting_first_report":0}},"rejected24h":4,"devices":[{"id":"...","serial":"HB-7K3Q-9XMC","name":"lab-004","state":"inactive","reason":"silent","reasonText":"silent for 47 min","customer":{"name":"Sam","consent":true},"location":{"coarse":"Richardson, TX"},"lastSeen":"...","firmware":null,"keyAgeDays":41,"power":null,"batch":"2026-11-lab"}],"next":null}`
- `GET /api/ops/fleet?id=<deviceId>` detail plus `history` (last 100 events). `GET /api/ops/fleet?view=rejected` rejection buckets.
- `POST /api/ops/fleet-actions` `{"deviceId":"...","action":"disable|enable|rotate_key|reassign_home|force_unlink|reissue_code|set_note","reason":"customer asked","homeId?":"...","note?":"..."}` returns `{ok:true,event:{...}}`; `rotate_key` adds `deviceKey` (once, `Cache-Control: no-store`); `reissue_code` adds `serial,pairingCode,qrPayload` (once).
- `POST /api/ops/fleet-batch` (**admin key only**; operator sessions get 403 even though middleware injects admin, detected by `ctx.data.operator`) `{"count":20,"prefix":"lab","type":"esp32","note":"","origin":"https://..."}` returns `{"batch":"2026-11-lab-a1","devices":[{"id","name","serial","pairingCode","deviceKey","qrPayload"}]}` once. Limit 100 per call.

Customer (cookie; same-origin writes; ids are link ids)
- `POST /api/customer/claim` existing body plus `room`, `emailAlerts`, `locationConsent`; `address` now optional. Response adds `next:"waiting_for_box"`.
- `GET /api/customer/devices` existing, plus per box `state`, `reason`, `firstContact`, `lastSeenAt`, `silentAfterSeconds`, `notificationsPausedUntil`, `room`.
- `PATCH /api/customer/devices?id=<linkId>` `{nickname?, room?, emailAlerts?, locationConsent?, notificationsPausedUntil?: iso|null}`.
- `DELETE /api/customer/devices?id=<linkId>[&reissue=1]` existing; with `reissue=1` returns `{serial, pairingCode}` once.

**Errors:** claim failures keep the uniform text with 400 and `Retry-After` on 429. Unknown id or other customer's id: 404. Action on wrong state (reissue while linked, reassign while linked): 409 with plain text. Validation: 400. Demo or non-admin batch: 403. Responses with secrets send `Cache-Control: no-store`.

## 7. Mesh and auto-pair (phase 2, not built)

Idea: box B reaches the internet through box A or a hub using a short-lived enrollment token, so a second box needs no Wi-Fi entry. Phase 2 would add: an operator or customer-issued single-use token (10 min, bound to B's serial), an ESP-NOW enroll message A relays, and a server endpoint exchanging token for B's join approval. **Not built now:** tokens, relay of enrollment, any change to ESP-NOW framing, key transport to a box over the mesh (keys still arrive only by flashing), and any claim without serial and code. Today each mesh box already carries every box's key in `MESH_NODES`; that stays a bench-provision concern.

## 8. Test plan

- `test/onboarding.test.js` (S, replica-set Mongo as customer tests): batch creates N unique serials with valid checksum; code v2 hashes with HMAC and verifies; legacy 6-digit still claims; `expiresAt:null` claims; second account blocked and logged; lock at 10; reissue; unlink then relink; unlink with reissue; claim without address creates a home and ingest succeeds; customer view never shows another customer's box; no secrets in any response log or lifecycle row.
- `test/fleet.test.js` (S): derive state matrix (all reasons, precedence, `lastSeen:null`, threshold with 1800 s interval); sweep idempotent under two concurrent runs; rejected-key buckets (raw key never stored, cap works); demo read-only; operator never sees address or non-consented name; actions require reason; admin-only batch; rotate invalidates old key at once.
- `test/provision.test.js` (P): serial alphabet and checksum, uniqueness, manifest mode 600, label HTML escapes input, no key printed (capture stdout), QR round trip.
- C adds `test/customer-onboarding-ui.test.js` (DOM-free unit tests of the rendering and checksum helpers, escaped strings).
- **Simulator e2e** (`test/onboarding-e2e.test.js`, S owns): in-process handlers with an injected clock. Steps: batch of 3, simulated box posts with its key to `/api/beacon/ingest` (expect 409, `lastContactAt` set, state `not_linked`), customer claims (state `awaiting_first_report`), box posts (state `active`, `first_report`), clock advances beyond `silentAfter` (state `silent`, one event, one email attempt to the sink address), box resumes (`recovered`), wrong-key post (rejection bucket), second account claim (blocked), customer unlink with reissue (inactive, new claim by a second customer works), operator disable (state `disabled`, ingest 401, logged).
- Existing customer, app, beacon and middleware suites stay green.

## 9. Module split

Four disjoint modules. Nobody edits `src/beacon.js`, `src/auth.js`, `scripts/commands/devices.mjs`, `workers/*`, UNOQ files, or other teams' `ui/command/*`.

### S: server
**Owns:** `src/onboarding.js`, `src/fleet.js`, `functions/api/ops/fleet.js`, `functions/api/ops/fleet-actions.js`, `functions/api/ops/fleet-batch.js`, `functions/api/customer/*` additions, `src/customer.js` (sole editor), `src/app.js` (sole editor), `functions/api/_middleware.js` (sole editor), `test/onboarding.test.js`, `test/fleet.test.js`, `test/onboarding-e2e.test.js`.
**Must do:** v2 serial/code helpers exported from `src/onboarding.js` (`makeSerialV2`, `serialCheck`, `makeCodeV2`, `hashCode`, `normalizeCode` accepting both formats; `src/customer.js` imports them); pepper derivation; `expiresAt:null`; lifecycle writer `recordEvent(db, {...})`; `deriveState`; sweep; rejection log hooked in `app.js` `handle()` (catch 401 on device-key paths, record, rethrow; also set `fleet.lastContactAt` on 409 and `fleet.firstSeenAt`/optional `X-Device-Firmware`); middleware: allow `/api/ops/fleet*` (demo GET only for `/api/ops/fleet`), keep customer routes cookie-only; `ensureFleetIndexes`.
**Exports consumed by others:** the JSON contracts in section 6 and `deriveState` reason strings exactly as listed: `not_linked awaiting_first_report silent disabled unlinked`.

### C: customer UI
**Owns:** `ui/customer.js`, `ui/customer.css`, `public/customer.html` (only if needed), `test/customer-onboarding-ui.test.js`.
**Must do:** Add my box flow (scan or type, checksum hint, confirm name/room, consents, optional address), live "Waiting for your box to report" card using `GET /api/customer/devices` (10 s), manage menu (rename, room, pause notifications, unlink, transfer with once-shown code, remove), Wi-Fi guidance and factory-reset copy including the gaps (G1 to G3 stated plainly), fragment regex accepting v2 and 6-digit codes, all strings escaped, vendored ARGUS kit components only, no em dashes. Must not call any operator endpoint.

### O: operator fleet panel
**Owns:** `ui/command/fleet.js`, `ui/command/fleet.css`, one marked hook line in `ui/command/index.js` (re-read immediately before editing), `docs/FLEET.md`.
**Must do:** list/filter/search/sort, state chips, header counts, rejected-keys view, Manage drawer with reason prompts and typed-serial confirms, once-only secret display (close clears it from the DOM, no storage), demo read-only, unknown shown as "unknown", never any address field. Consumes only `GET /api/ops/fleet`, `POST /api/ops/fleet-actions`. Exports `mountFleet(container, {api, role})`.

### P: provisioning and labels
**Owns:** `scripts/commands/provision.mjs` (new, registered through the hb plugin loader as `provision`, alias `devices provision` documented in usage text; `devices.mjs` untouched), `scripts/lib/labels.mjs`, `scripts/lib/qr.mjs` (pure JS encoder: byte mode, error correction M, versions 1 to 10, mask selection by penalty, with a unit test that decodes its own matrix and checks Reed-Solomon remainder and format bits against known constants; reuse an installed QR package only if one is already in `node_modules`, none was found), `docs/CLI.md` section "Provisioning", `docs/HARDWARE.md` section "Box inventory", `test/provision.test.js`.
**Must do:** `provision --count --prefix [--type] [--home-less] [--note] [--dry-run]` and `provision rotate <id>`; call `POST /api/ops/fleet-batch` with the admin key from env (never printed); write `work/inventory/<batch>.json` (mode 600, keys inside) and `work/labels/<batch>/sheet.html` (outer sticker and pairing card per box, SVG QR, print CSS, all text escaped, `work/` already ignored); refuse to overwrite an existing batch; print only counts, batch id and file paths; write a per-box `secrets.<serial>.h` only when `--secrets-dir` is given (mode 600, existing ignore pattern).

**Cross-module contract summary:** P calls S's batch endpoint; O calls S's fleet endpoints; C calls S's customer endpoints; QR payload is the exact string from S's `qrPayload`; reason strings and field names are those in section 6. Any contract change goes through the architect.
