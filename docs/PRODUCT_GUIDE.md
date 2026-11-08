# Safe Home product guide

Current as of November 8, 2026. Safe Home is the new product name for HomeBeacon. The site supports household awareness and operator review using device reports and nearby public context. It does not certify safety or dispatch emergency services.

## The three readings to notice first

**Power** tells you what the device actually reported about mains power or its power mode. **Wi-Fi/connectivity** separates a reported connection state from silence. **Conditions** summarizes supported sensor evidence and open concerns. Green requires supporting recent normal observations; a newly registered or silent device is not automatically green.

An elevated status means a supported rule or recorded condition needs attention. Critical means critical evidence requires review. Missing data is unknown, and an unresolved critical condition remains visible even when reports grow old. Nearby device silence can suggest a regional connection/power problem, but does not itself establish a disaster, occupancy or damage.

## Household journey

1. Open the device QR link or visit `/signup`. Create an account or sign in.
2. On `/customer`, choose **Add device**. Enter the serial and pairing code if the QR did not supply them, plus the installation address.
3. The server validates the code and address, then links the device to the account. Codes are private credentials, not public identifiers to paste into support posts.
4. View reports, timestamps and customer-visible operator updates. Registration does not create synthetic readings. The view refreshes about every ten seconds when available.
5. Use household sharing to select devices and create a private invitation link for another account. The recipient accepts while signed in to the addressed account. Owners can revoke access; members can leave.

Address matching uses the Census geocoder. Coordinates are approximate address-range locations, not independently surveyed points. A nearby Google Street View image appears only when that provider is configured and may be old or show another building. Neither location nor imagery proves current conditions.

Self-built boxes use **Build your own box**, a current password and an installation address. A device key is shown once for hardware configuration. The operator sees that the box is self-built and unverified. [Customer](CUSTOMER.md) and [assistant connections](ASSISTANT_CONNECTIONS.md) hold the exact limits and contracts.

## Operator journey

Sign in through `/login` or `/portal` with an explicitly provisioned operator account. The command center opens a lower-48 map. Select a state to zoom, select a device to open its full workspace, or use the device list when a map is inconvenient.

- **Conditions:** power, connection, sensor concerns, source age and optional model assistance.
- **Workflow:** full dotted canvas, left event history and playback above. Replay begins with one checkpoint; new stages appear as events arrive. Click a node for its recorded explanation and optional rule/evidence detail.
- **Sensors and Logs:** measured reports, units, history and recorded device/server events.
- **Messages:** human-created device messages and their delivery states.
- **Customer:** account linkage and recorded follow-up status, within operator permissions.

The map's view menu changes the geographic presentation for wind, sun, UV, temperature, terrain, flood zones, rivers/coast, air, fire, faults/earthquakes, power, alerts, declarations and shelters. Select **Sources & coverage** to see freshness, missing values and provider limitations. Weather forecast samples are not street-by-street measurements. Flood maps describe mapped hazard zones, not current water depth. Fault traces are geological context, not predictions.

## Sending information to a box

An operator can queue a short message for a permitted device or region. The box retrieves messages when it next connects and polls. Delivery/acknowledgement states are separate from the operator's send action. Offline boxes may not receive a message before expiry. Read [downlink](LIVE_DOWNLINK.md) and the [device client contract](../clients/esp32/DOWNLINK.md).

Help-status records are entered by people. A label such as “help on the way” must reflect a real human update, not a model inference or an automatically inferred dispatch. The software is not connected to an emergency dispatch service.

## Simulations and assistants

`/simulations` offers five setup steps: place, event, devices, normal readings and review/advanced settings. Wind, earthquake, flood, fire and outage scenarios are illustrative test rules. Population, placement, footprint and thresholds affect the synthetic world only. The same versioned configuration runs through the CLI, HTTP API and MCP tools. Nothing is written into live hazard records. [Simulation guide](SIMULATIONS.md).

Customer MCP connections require OAuth scope and can read the account's supported reports/setup information and run synthetic simulations. They cannot reveal hardware keys or send responders. Optional customer NVIDIA keys are encrypted and used only for that account's explicit requests. Operator inference is a separate permission path. Current provider/model uptime must be checked independently.

## History and limits

The box-side recorder keeps bounded local samples and reference statistics while disconnected, then uses the retained-history contract on reconnect. Website history also uses daily archives. Historical averages describe the available sample quality; they are not automatic replacements for calibrated alarm thresholds. See [device history](DEVICE_HISTORY.md).

Email invitation/alert implementation and HTML templates exist, but actual email delivery is disabled. Manual invitation links work without email sending. Regional news is available only for supported publishers and never changes hazard risk. Physical battery endurance, sensor calibration, mesh fallback and reconnect replay require board tests. Complete manual accessibility and legal/privacy review remain separate from automated software checks.
