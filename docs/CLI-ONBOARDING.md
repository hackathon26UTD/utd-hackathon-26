Current rollout: inventory routes are released. See [DASHBOARD_ONBOARDING.md](DASHBOARD_ONBOARDING.md) for the shared account entry and repeatable hardware-to-live-view acceptance process.

# Safe Home inventory CLI

Implemented locally on November 8, 2026. Server routes are a separate workstream; these commands do not deploy, flash hardware, or prove that a box reports.

## Create inventory

```sh
npm run hb -- devices provision --count 10 --prefix pilot --dry-run
npm run hb -- provision batch --count 10 --prefix pilot --yes
npm run hb -- devices provision --count 10 --prefix pilot --yes --secrets-dir .secrets/firmware
```

`hb devices provision` and `hb provision batch` call the same command. `hb provision add --prefix pilot` creates one box. Remote creation requires `--yes`; local development uses `--local`. `--dry-run` sends nothing and writes nothing. `--json` returns only nonsecret output paths/counts.

New inventory is home-less by default. `--home-less` remains an optional explicit flag; `--no-home-less` is refused. No synthetic homes are created. The existing `npm run provision` script is unchanged.

Options:

- `--count`: integer 1–100; `add` accepts only 1.
- `--prefix`: 1–24 letters/digits/hyphens, starting with a letter or digit.
- `--type`: `esp32` (default), `xiao-esp32s3-sense`, or `unoq`.
- `--note`: up to 160 plain characters.
- `--expected-report-interval-seconds`: optional integer from 5 to 86400.
- `--site`: target API origin. HTTPS required except local development.
- `--origin`: pairing-card origin; defaults to the API site. It does not change the firmware API destination.
- `--out-dir`: defaults to `.secrets/onboarding`.
- `--secrets-dir`: optionally generate a separate header for each device under a fresh private subdirectory. Without this flag, keys remain in the manifest only. For Uno Q, transfer the per-device key into the agent environment; a C header does not configure that agent.

The API call is `POST /api/ops/fleet-batch`, authenticated with `API_ADMIN_KEY` (local override: `HB_LOCAL_ADMIN_KEY`). The request has `count`, `prefix`, `type`, `note`, `origin` and optional `expectedReportIntervalSeconds`. The current response uses `batchId`, and each device has `deviceId`, `serial`, `deviceKey`, `pairingCode`, `qr`, and `expiresAt:null`. `qrPayload` is also accepted. The returned QR must exactly match `ORIGIN/customer#claim=SERIAL.CODE` at the API origin or the explicitly selected card origin; unrelated domains, wrong paths and mismatched credentials are refused. The server currently uses its request origin. When `--origin` differs, the CLI validates that returned QR before generating the same claim at the selected card origin. The raw server QR remains in the private manifest, alongside the requested card origin.

Serial checksum: remove `HB-` and the grouping hyphen; the eighth character is the sum of `alphabet.indexOf(character) * (position + 1)` over the first seven, modulo `alphabet.length`. The supplied alphabet `ABCDEFGHJKMNPQRSTUVWXYZ23456789` contains **31**, not 30, characters. Existing serials remain accepted regardless of checksum. Codes accept grouped or ungrouped eight-character values and legacy six digits.

## Private outputs

Each invocation reserves a fresh `batch-<random>/` or `rotation-<random>/` directory before contacting the server. It creates `manifest.json`, a batch `sheet.html`, and optional separate headers named `secrets.001.h`, etc. The manifest records the matching header paths in device order, plus the request and the raw response under `response` (`response.devices` for batches; `response.deviceKey` for rotation). This preserves one-time credentials even when response validation or label rendering fails. Empty reserved files may remain after failed requests; `provision list` lists local batch directories, not confirmed server transactions.

All secret files are mode **600**, all newly created private directories **700**. Existing destination directories must already be owned by you with mode 700. Destinations must be outside the checkout, or under `.secrets/` and actually ignored by Git. Other ignored folders such as `work/`, tracked paths, existing target files, and symbolic-link paths are refused. Private writes use exclusive creation, held file descriptors, and path/file identity checks. Repeated commands never overwrite prior artifacts. A repeated successful batch request creates additional server inventory; it is not an idempotent retry.

The outer sticker contains only the serial. The pairing card contains the code and QR, never the device key. Print locally; keep the inner card private. The HTML sheet and any printed PDF contain claim credentials. Delete unneeded copies after printing. Each firmware header contains only that device's key and its own standalone mesh configuration. Existing board secrets and mesh files are untouched. Installer Wi-Fi comes from the environment; this command does not provide customer Wi-Fi setup or automatic flashing.

## Rotate a device key

```sh
npm run hb -- devices provision rotate DEVICE_ID --confirm SERIAL --reason 'replace compromised key' --dry-run
npm run hb -- provision rotate DEVICE_ID --confirm SERIAL --reason 'replace compromised key' --secrets-dir .secrets/rotated-firmware
```

Replace `DEVICE_ID` with its 24-character ID and `SERIAL` with the actual box serial. Rotation uses `POST /api/ops/fleet/:id/action` with `{action:"rotate_key", confirmSerial, reason}`. The server verifies the typed serial. The response key is saved privately. No lookup of the obsolete fleet-actions route is needed.

**The old key stops working immediately.** The confirmation and reason authorize the action. Reflash the physical box or update its agent environment with the saved per-device key. No key is sent through the message/settings channel. A successful API response does not mean the box has received the replacement key.

If a write fails or times out, inspect the fleet and the reported private manifest before retrying; the server may already have changed the device. Server and transport error bodies are not printed because they may echo credentials.

## Existing CLI and checks

`devices list`, `devices show`, and `devices register` remain available. Registration now reserves a private output file before creation and applies the same path/permission rules. Its default key file is uniquely named under `.secrets/`; `--key-file` still chooses an explicit path.

```sh
node --test test/hb-cli.test.js test/hb-onboarding-cli.test.js test/hb-labels.test.js
```

The new tests cover aliases, object-shaped API clients, request/response contracts, rotation, private output and recovery, permissions, overwrite refusal, symlinks/hardlinks, nonsecret output, legacy formats and firmware isolation. QR tests use independent OpenCV decoding for all supported versions 1–10 and the actual label SVG rasterized with `sharp`. They explicitly skip if optional local decoder/rasterizer dependencies are absent; set `HB_QR_PYTHON` to a Python with `opencv-python` installed. No runtime dependency was added.

Local validation: **36 tests passed, zero failures and zero skips**, including independent QR decoding. The four owned modules pass Node syntax checks. CLI API tests use injected responses; production provisioning and physical flashing were not performed.

This CLI guide takes precedence over the older draft CLI/API/output descriptions in `ONBOARDING.md` for these commands. Server, customer UI and firmware changes remain separately owned. No commits or production mutations were made by this CLI workstream.
