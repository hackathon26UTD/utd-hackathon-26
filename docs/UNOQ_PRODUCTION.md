## November 8 onboarding handoff update

The canonical production identity is now **Uno Q hub** (`6af08de410eb36e804a787ed`), using its existing registered UT Dallas home (`6af08de310eb36e804a787ec`). The earlier controller-only identity below is disabled; its history remains. No key was rotated.

The current host uploader runs from `/private/tmp/hb-onboard`, PID recorded in `work/unoq-hub-live.pid`, log `work/unoq-hub-live.log`. Its ignored private configuration is `.secrets/unoq-hub.json` (mode 600). Restart with `node scripts/uno-to-dashboard.mjs --live --key-file .secrets/unoq-hub.json --hub-adb --adb /private/tmp/homebeacon-households-20261108/work/platform-tools/adb --serial 3058549169`, under caffeinate if needed. Check the PID command before stopping it. These temporary checkout paths must be preserved or moved deliberately.

Stable agent 0.1.0 and private configuration are staged on the Q under `/home/arduino/.local/share/safe-home/agent`, `/home/arduino/.config/safe-home/unoq.toml`, and `/home/arduino/.config/safe-home/device-key` (mode 600). Self-test passed. Root installation requires the board sudo password and no service is started. Wi-Fi is down; the Mac bridge remains the actual uplink. The private claim card/label is in ignored `.secrets/unoq-hub-pairing.json` and `.secrets/unoq-hub-label.html`. No customer has been linked.

Earlier evidence follows for history, not current startup instructions.

# Real Uno Q controller setup

November 8, 2026, Ayan workstream. The connected Arduino Uno Q is registered as **Safe Home Uno Q controller**, production device `6af08b8712d27d9187429ea8`, USB serial `3058549169`. It is the box's Linux controller, not simulated data. Existing Box A and Box B identities and keys are preserved.

## Verified path

Uno Q Linux system sampler → identified USB ADB connection → laptop uploader → device-key HTTPS ingest → production operator live API. CPU temperature, available memory, one-minute CPU load, uptime and actual `wlan0` link state were received and read back from production. Example: 36.1 °C, 3212 MB available, Wi-Fi disconnected. Sampling targets ten seconds plus request time; the operator already polls about every four seconds.

The sampler reuses `agents/unoq/hbagent/system.py`. It is copied under `/home/arduino/safe-home-agent`; no firmware was flashed, no existing service replaced, no credentials copied onto the board, and no power settings changed. CPU temperature follows the existing sampler's maximum thermal-zone reading; it is not room temperature. Wi-Fi link state is not proof of Internet access.

The current Mac keeps the uploader running while attached and awake. A USB disconnect or unconfirmed write stops it. This is a host-assisted setup, not standalone Wi-Fi delivery. The service has not been installed to run at login. The current checkout is under `/private/tmp`; move the private setup to durable storage before relying on it beyond the hackathon.

## Start or stop

Store the device's private JSON in an ignored file, mode 0600:

```json
{"site":"https://utd-hackathon-26.pages.dev","exercise":false,"deviceId":"<registered id>","deviceKey":"<private device key>"}
```

On this Mac the file is `.secrets/unoq-live.json`; never commit it. Only this device's key is used. The API master key stays off the board and browser.

```sh
adb push agents/unoq/. /home/arduino/safe-home-agent
node scripts/uno-to-dashboard.mjs --live --key-file .secrets/unoq-live.json \
  --hub-adb --adb /path/to/adb --serial 3058549169
```

The running process id and output are in ignored `work/unoq-controller-live.pid` and `work/unoq-controller-live.log`. Stop the recorded process group before restarting; do not run two writers. An unconfirmed write needs inspection before restart, not blind replay. Nothing resubmits a buffered report as a new observation.

For an actual Uno sensor sketch emitting complete `src: "unoq"` reports, use the same uploader with `--port /dev/cu.usbmodem...` instead of `--hub-adb`. Serial input is flushed before listening. This mode reports measured water/flame/tilt values only, without claiming calibration. Default bench mode remains exercise data.

## Still missing

- No location has been supplied. The device is visible in Devices but has no invented map pin or assigned home. Add its actual address before canonical home telemetry and map placement.
- The reconnected board does not currently emit sensor JSON. Its Wi-Fi interface is down. Existing Box A's historical critical flame evidence stays separate and unchanged.
- Wall power, battery charge/endurance, physical sensor calibration, disconnected persistence, downlink display and autonomous networking are not verified.
- Before production dependence: configure Wi-Fi privately, commission actual sensors, assign the verified address, and test outage/reconnect behavior. The standalone agent instructions remain in [UNOQ_AGENT.md](UNOQ_AGENT.md).
