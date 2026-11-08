# Customer alert email groundwork

Presentation-only groundwork for Ayan's HomeBeacon workstream, November 8, 2026. No email provider, recipient lookup, sending, automatic queue/outbox, subscriptions or deliveries are enabled. These previews are synthetic. Box and website history is a subsequent parent task, not implemented here.

## Parent integration

```js
import { renderCustomerAlertEmail } from './customer-alert-email.js';
const {subject, html, text} = renderCustomerAlertEmail({
  event: 'detected-condition',
  homeLabel: 'Example home',
  severity: 'critical',
  source: 'simulation',
  observedAt: '2026-11-08T12:00:00Z',
  now: '2026-11-08T12:05:00Z',
  power: 'battery',
  wifi: 'offline',
  conditions: ['water'],
});
```

The pure renderer does not read the clock. Pass `now` and the **actual observation time**, not insertion/ingest/render time, as UTC ISO strings. More than 15 minutes old is stale; missing, invalid or future observation time means unknown freshness. `event: 'stale-offline'` or `freshness: 'stale'` forces the stale label. Critical remains last-known critical when stale/unknown. Recovery always says review needed; it does not establish safety, occupancy, entry permission or dispatch. Synthetic source adds EXERCISE to the subject and heading.

Supported fields:

- `event`: `detected-condition`, `stale-offline`, `recovery-needs-review`; unsupported events throw.
- `severity`: `critical`; all other values display Review needed.
- `source`: `device`, `operator`, `simulation`; otherwise Unknown source.
- `power`: `on`, `out`, `battery`, `unknown`.
- `wifi`: `connected`, `offline`, `unknown`.
- `conditions`: array containing `water`, `smoke`, `heat`, `impact`, `none_detected`, `unknown`. Unknown entries are omitted; duplicates removed; detected facts suppress contradictory normal/unknown facts.
- `homeLabel`: escaped, control-stripped, maximum 100 characters. Avoid addresses unless later explicitly authorized.
- `observedAt`, `now`: UTC ISO timestamps. `freshness: 'stale'` can conservatively override time.
- `customerUrl`: only exact HTTPS origin `https://utd-hackathon-26.pages.dev`, path `/customer`, without userinfo/query/fragment. Unsupported URLs fall back to that fixed customer page. No arbitrary preview/custom domain is accepted; add a reviewed fixed origin when production changes.

Unknown fields, raw HTML, notes, dispatch claims, arbitrary condition text and custom links never enter the email. All dynamic HTML values are escaped; subject uses only fixed event labels and exercise flag. Plain text retains readable label characters without interpreting them. Parent must map verified simulation/device contracts to these enums rather than forwarding arbitrary sensor or model output. A single observation timestamp must truthfully describe all provided facts; do not combine stale power with newer conditions under one fresh timestamp.

## Preview

`node scripts/preview-customer-email.mjs [output-directory]` (parent also added `npm run email:preview -- [output-directory]`). Default: `work/customer-email-preview`. Writes three HTML and three text examples for the supported events with synthetic home/source/time and no recipients. It does not contact any service. Output files are local and should not be treated as delivered messages.

## Before any future delivery

These are future requirements, not enabled functionality:

1. Explicit, separately recorded alert opt-in; existing general contact consent is not sufficient by itself.
2. Verified recipient ownership, re-verification after email changes, account isolation and recipient resolution only on the server. Current account-email flows report `emailVerified: false`.
3. Event/recipient/channel idempotency, durable receipts, retry bounds, cooldown/rate policy, and a dedicated reviewed delivery queue. Never turn render calls into sends or let retries double-send.
4. Accessible unsubscribe/preferences and immediate suppression enforcement, including queued messages; any unsubscribe token must be scoped and purpose-specific. Do not reuse the customer-link renderer field for such URLs.
5. Provider configuration, sender authentication, failure/bounce handling, data retention and privacy review. No credentials in client bundles or preview outputs.
6. Preserve original observation/source/freshness and stale critical evidence. Human review governs outreach; no automatic dispatch/safety claims.

## Tests

`node --test test/customer-alert-email.test.js` covers escaped HTML, unknown/prototype-like enum values, ignored unsafe fields, URL allowlisting, timestamp/freshness boundaries, last-known critical labels, recovery/exercise wording and deterministic rendering. Tests do not send email.
