# HomeBeacon downlink: messages and logs

Operators can send short messages ("information boxes") to a device. The device pulls them. It never listens for inbound connections. Telemetry rules in `HOMEBEACON.md` are unchanged; this adds one hint to the ingest answer and three small endpoints.

## Loop

1. Send telemetry as before to `POST /api/beacon/ingest` (or `/api/ingest`).
2. A `202` answer now also carries `messages_pending` (count of unseen messages) and `poll_after_s` (30, or 10 while an urgent message is open). Every existing field is unchanged.
3. If `messages_pending > 0`, call `GET /api/device/messages?after=<last seq>&limit=3` with `X-Device-Key`.
4. Show each message. Report `shown`, and `acked` after the button press when `requires_ack` is true.
5. On boot start with `after=0` to pick up messages still live.

## Endpoints (header `X-Device-Key`)

| Call | Body or query | Answer |
|---|---|---|
| `GET /api/device/messages` | `after`, `limit` (1 to 3) | `{messages:[{seq,id,kind,severity,title,body,expires_at,requires_ack}],cursor,poll_after_s}` |
| `POST /api/device/messages` | `{message_id,state:"shown"\|"acked"}` | `{state}` |
| `POST /api/device/logs` | `{entries:[{ts?,level,code,msg}]}` up to 20 | `{accepted}` |

Small screen limits: title 20 characters, body 80, printable ASCII, 21 characters by 8 lines. `severity:"urgent"` should take over the display. Messages expire (default 6 hours, at most 7 days) and a device holds at most 5 live ones.

Log `level` is debug, info, warn or error; `code` is 1 to 40 characters of letters, digits and `. _ : -`; `msg` is cut at 120 characters. Never put keys or passwords in a log; anything that looks like one is stored as `[redacted]`. `ts` is optional and ignored if the device clock is more than 24 hours behind or 5 minutes ahead. Logs are kept 14 days.

Errors: `401` bad key, `404` message not for this device, `409` message no longer active, `429` too many (wait a minute).

## Power save

Send `power_mode` (`normal`, `saver` or `critical`) through `/api/ingest` when it changes. The server records the change in the device log. A device in saver mode can poll less often; honor `poll_after_s` as a minimum.

## Code

`downlink_snippet.h` has the pull, ack and log helpers. Trust the Cloudflare root CA in `secrets.h`; do not use `setInsecure()`. The real board and display have not been tested with it.
