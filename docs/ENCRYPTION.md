# Encryption and security protocols

What protects each link in HomeBeacon, at what strength, and where the gaps are. Facts about the ESP32 side were checked against the installed toolchain (arduino-esp32 3.3.12 / ESP-IDF sdkconfig, `esp_now.h`) on 2026-11-08. Hardware tests: [WORKLOG](WORKLOG.md), [firmware/TESTING.md](../firmware/TESTING.md).

## Summary

| Link | Protocol | Strength | Authentication | Status |
| --- | --- | --- | --- | --- |
| Box ↔ box (ESP-NOW mesh) | **CCMP: AES-128 in CCM mode** (IEEE 802.11i), per-peer keys | 128-bit keys | Message integrity code; only provisioned MACs are peers | **Tested on hardware** (wrong key rejected) |
| Box → cloud API | **HTTPS, TLS 1.2** (mbedTLS) | Cipher negotiated by TLS 1.2 (AES-GCM / ChaCha20 suites) | Server certificate verified against 4 pinned root CAs; box sends a 192-bit device key | Compiles; certificate check not yet run against the live API on hardware |
| Browser / scripts → cloud | HTTPS (Cloudflare, TLS 1.2+/1.3) | Cloudflare edge defaults | Operator sessions / admin bearer key | Live |
| Cloud API → MongoDB Atlas | TLS (Atlas requires it) | Atlas defaults | Database user + password, `readWrite` on one database | Live |
| Box A → Uno Q hub | USB serial cable | None (physical link) | Physical access | Planned |
| Hub dashboard (local network) | **Plain HTTP + Basic auth** | **Not encrypted in transit** | Password (`HUB_PASSWORD`) | Gap: use only on a trusted local network |
| Data at rest on the box (microSD log, flash) | None | Not encrypted | Physical access | Gap |

## 1. Box-to-box mesh: ESP-NOW with CCMP (AES-128)

- **Cipher:** ESP-NOW encrypts each unicast frame with **CCMP**, the AES-128 Counter-with-CBC-MAC mode from 802.11i (the same frame protection WPA2 uses). It gives **confidentiality** (AES-128 counter-mode encryption) and **integrity/authenticity** (a CBC-MAC message integrity code): a frame that was altered or encrypted with a different key is discarded by the radio before our code sees it.
- **Keys:** two 16-byte (128-bit) keys, `ESP_NOW_KEY_LEN = 16`:
  - **PMK** (primary master key), set with `esp_now_set_pmk()`, used to encrypt the per-peer key.
  - **LMK** (local master key), set per peer (`peer.lmk`, `peer.encrypt = true`), used to encrypt that peer's frames.
  - `npm run provision` generates both with a cryptographically secure random generator (`crypto.randomBytes(16)`) and writes them only to git-ignored `secrets.h` files. **The bare `mesh_test` sketch uses fixed test keys printed in the source: test benches only.**
- **Who can talk:** each box adds only the provisioned MACs as encrypted peers (`MESH_NODES`). Unknown senders and wrong keys are dropped.
- **Limits:** unicast only (encrypted broadcast is not supported by ESP-NOW, so the mesh floods by unicasting to each peer). The build allows **7 encrypted peers** (`CONFIG_ESP_WIFI_ESPNOW_MAX_ENCRYPT_NUM=7`), so up to 8 boxes per neighbourhood.
- **Application layer on top:** every message carries `(origin, boot, seq)`. Boot counters persist in flash, gateways ignore message IDs they delivered recently (last 256), and the API keeps one telemetry record per `event_id`, so duplicates and simple replays do not create new records. TTL (5 hops) bounds flooding.
- **Verified on hardware (2026-11-08):** with one LMK digit changed on box B, box A's radio received all 60 frames over the air (`sent ok=60`) but accepted none (`acked=0`); restoring the key restored delivery immediately.

## 2. Box-to-cloud: HTTPS (TLS 1.2) with pinned roots

- **Protocol:** `WiFiClientSecure` (mbedTLS) with **TLS 1.2** (`CONFIG_MBEDTLS_SSL_PROTO_TLS1_2=y`; TLS 1.3 is not enabled in this ESP32 build). Cipher suite negotiated with Cloudflare.
- **Server authentication:** the box only accepts certificates chaining to four pinned roots in `firmware/common/root_ca.h`: **ISRG Root X1, ISRG Root X2** (Let's Encrypt) and **GTS Root R1, R4** (Google Trust Services), the CAs Cloudflare uses for `*.pages.dev`. A server signed by anyone else fails the TLS handshake, so the device key is never sent to it. Regenerate with `node scripts/gen-root-ca.mjs` if Cloudflare changes CA.
- **Device authentication:** header `X-Device-Key`: `dk_` + 48 hex characters = **192 bits** of randomness from `crypto.getRandomValues`. The server stores only its **SHA-256** hash and finds the device by that hash, so a database leak does not reveal usable keys; keys can be disabled or rotated (`PATCH /api/devices/:id`). (The admin bearer key is compared in constant time.)

## 3. Cloud side (summary)

Cloudflare terminates HTTPS for the site and API. Operator sign-in uses server-side sessions (Ayan's workstream; see [ACCESSIBILITY_AND_ACCOUNT.md](ACCESSIBILITY_AND_ACCOUNT.md)). The API reaches MongoDB Atlas over TLS with a least-privilege database user. Secrets live in Cloudflare and GitHub Actions secret stores and each person's git-ignored `.env`; never in the repository.

## 4. Known gaps (say these honestly)

1. **Shared upload keys inside a neighbourhood:** any box can be the gateway, so every box holds every box's device key. A stolen box exposes its neighbours' keys until they are disabled. Production fix: a per-box relay credential and server-side checks that a gateway may only relay for its own neighbourhood.
2. **No encryption at rest:** the microSD log and the keys in flash are readable by someone holding the box. ESP32 flash encryption and secure boot exist but are not enabled for the hackathon.
3. **Hub dashboard is plain HTTP** on the local network (password, but not encrypted in transit).
4. **Replay protection is application-level and windowed**, not cryptographic sequence enforcement across all gateways.
5. **Test sketch keys are public**; never deploy `mesh_test` keys.

## Pitch line

"Box-to-box radio uses AES-128 (CCMP) with per-device keys; uploads use TLS 1.2 with certificate pinning; each box has its own revocable 192-bit key, stored server-side only as a hash."
