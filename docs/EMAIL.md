# Email (Resend)

HomeBeacon sends a small set of branded emails through the Resend REST API. It is off until a key is set. Email can never fail or slow a request: every send runs in the background after the response.

## Turn it on

| Name | Kind | Default | Purpose |
|---|---|---|---|
| `RESEND_API_KEY` | secret | none | Turns email on. No key means no email and no extra database connections. |
| `EMAIL_ENABLED` | plain | on when a key exists | Set `false` to switch off without removing the key. |
| `EMAIL_FROM` | plain | `SafeHome <alerts@safehome.endyland.com>` | Sender. Must be on a domain verified in Resend. |
| `EMAIL_REPLY_TO` | plain | none | Optional reply address. |
| `EMAIL_OPERATOR_TO` | plain | none | Comma separated operator addresses for incident alerts and digests. |
| `EMAIL_TEST_ALLOWLIST` | plain | none | Real addresses allowed as test recipients. Sinks always work. |
| `APP_ORIGIN` | plain | `https://utd-hackathon-26.pages.dev` | Origin used for links in emails. Must be https. |

Set the secret with `wrangler pages secret put RESEND_API_KEY`. Never put it in the repo, a board or a browser bundle.

Switching sender domain: verify the domain in Resend, then set `EMAIL_FROM`. The default sender domain is `safehome.endyland.com`, verified in Resend on November 8, 2026 (DKIM, SPF, MX and return-path records live in the endyland.com Cloudflare zone, and the pre-change zone export is kept off-repo).

## Emails

| Template | To | Sent when |
|---|---|---|
| `welcome` | customer | Account created or device claimed. Sent even if contact consent is off, because the person just did it. |
| `help-status` | customer | Help status becomes queued, assigned, on the way or resolved. Needs contact consent. |
| `critical-incident` | operators | Call `notifyCriticalIncident` (not wired to ingest yet). Shows known and unknown readings and freshness. |
| `digest` | operators | Call `notifyDigest` (not wired to a schedule yet). |
| `account-notice` | account holder | Call `notifyAccountNotice` after a password change or recovery. Never contains a code or sign-in link. |
| `receipt` | customer | A customer-visible message is confirmed on the device. Needs contact consent. |

Wired today: welcome (register and claim), help-status (operator sets status), receipt (needs `deviceReport(..., { email: ctx })` in the device endpoint). The others are ready to call from `src/email-events.js`.

## Rules the code enforces

- Unknown stays unknown. Stale critical evidence is labelled last known, never safe.
- Nothing implies safe entry, occupancy, damage probability, coverage or dispatch.
- Customer mail carries the prototype and emergency line.
- Every dynamic value is HTML escaped. Subjects carry no untrusted text except one cleaned device label in operator mail.
- Dedupe: one email per event, device, recipient and state per window (record id is the key).
- Throttle: 4 per hour per customer address, 12 per hour per operator address.
- Records live in `email_events` for 30 days. They hold a hashed recipient, never an address or body.
- Retries: up to 3 tries on 429 and 5xx with backoff. Each send has an Idempotency-Key.
- Logs: one JSON line per send with template, hashed recipient, status. No body, no address.

## Commands

```
npm run hb -- email list
npm run hb -- email preview all --shots     # writes work/email-preview/*.html, .txt and PNGs (desktop, mobile, light, dark)
npm run hb -- email send-test welcome --keychain
```

`send-test` goes to `delivered@resend.dev` by default and refuses real addresses. `--keychain` reads `vault:resend-api-key` from the macOS Keychain in memory only. Use `--dry-run` to render without sending. Failure paths: `--to bounced@resend.dev` or `--to complained@resend.dev`.

## Ops endpoint

`POST /api/ops/email-test` with `{ "template": "digest", "to": "delivered@resend.dev", "dryRun": true }`. Admin key required, demo accounts refused, sink addresses only unless listed in `EMAIL_TEST_ALLOWLIST`. It sends synthetic exercise data.

## Limits

- Prototype quality, not a deliverability program. No unsubscribe handling beyond the consent flag.
- No tracking pixels, so no open or click data.
- Previews were checked in Chrome only, not in Outlook or Gmail clients.
- Password recovery stays code based. Email only tells the person it happened.
