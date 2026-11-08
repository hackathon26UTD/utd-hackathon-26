# Simulations

Open `/simulations`. `/demo` remains a compatible public route and the homepage's inert preset embed remains separate. User-facing navigation calls this **Simulations**.

Five setup pages use the actual Argus main tabs and select controls:

1. Place: lower-48 city or coordinates, world radius and smaller affected radius.
2. Event: normal, outage, wind, earthquake, flood or fire; intensity, outage/link-loss fractions, start/end/duration.
3. Devices: 1–500 points, scattered or concentrated near the center, repeatable seed.
4. Normal readings: starting temperature, humidity and battery.
5. Review: summary, JSON import/export and advanced simulation-only limits.

Start simulation opens the map. Play, pause, restart and seek work on the same generated world. One playback second advances one simulated minute at 1×. Hidden tabs pause. The user starts playback deliberately, including with reduced-motion preferences. Critical reports remain latched during recovery. The simulated clock controls freshness; leaving a paused browser open does not silently advance the world. No simulated telemetry, locations, incidents or messages are inserted in the live database.

## Model limits

The shared pure engine is `domain/simulation.js`, version 1. It generates deterministic per-device randomness from seed and index. Scattered placement is uniform in circular area; concentrated placement biases toward the center. Coordinates are fictional points in a bounded map extent, not verified addresses or occupied buildings. The affected footprint is a circle, not an official hazard zone.

Wind speed and earthquake magnitude scale illustrative outage likelihood. Earthquake scenarios add a synthetic motion observation. Flood depth affects water-positive probability; fire temperature sets affected sensor temperature. These are test rules, not calibrated physics, forecasts or damage probabilities. Power-loss and offline percentages are probabilities, not exact counts. Offline devices have a last received report; their values are not replaced with invented fresh observations. No-report thresholds only govern simulation freshness. Site danger rules and board firmware thresholds are unchanged.

The configuration includes a fixed ISO epoch with an explicit timezone, seed, all controls and schema version. Importing it and choosing the same minute yields the same frame. Adjusting or importing a configuration applies only when Start simulation is selected; leaving setup preserves the running world. Export current run saves a versioned `homebeacon-simulation` envelope with config and minute. Both that envelope and full CLI frames reopen at the saved minute by regenerating the engine output; imported property records are never trusted. Browser imports are capped at 2 MiB. Plain settings remain supported. Exported JSON contains only synthetic data.

A place-only request resolves that city's center. Explicit coordinates with a preset must match it; otherwise use `place: "custom"`. Recognized old `/demo?scenario=normal` and other preset links retain their original scenario. The homepage embed remains on its original preset path.

## Headless use

```
npm run simulate -- --schema
npm run simulate -- --config settings.json --minute 25 --output frame.json
npm run simulate -- --config frame.json --output reopened.json
npm run simulate -- --mcp
```

The CLI needs no database, browser or credentials. The MCP stdio mode exposes `homebeacon_simulation_settings` and `homebeacon_run_simulation`. Configure a local MCP client with command `node`, arguments `["/absolute/path/to/repository/scripts/simulations.mjs", "--mcp"]`. Nothing except protocol messages goes to stdout in that mode. JSON files passed to the CLI are data, never executed.

The remote personal MCP endpoint also exposes these two pure simulation tools alongside the three customer-report tools. Its existing OAuth authorization and revocation remain required. The account connection does not let a simulation read or change real devices. Existing operator CLI commands (`npm run data -- ...`) remain separately protected; personal MCP tokens are not infrastructure credentials.

HTTP: `GET /api/simulations` returns defaults/options. `POST /api/simulations` takes `{"config":{...},"minute":25}` and returns one synthetic frame. It is deliberately independent of MongoDB, secrets, registered households and real hazard data. Settings are limited to 16 KB, population to 500, duration to 240 minutes, known keys/types and bounded values. Unsupported settings fail instead of being silently accepted.

## Verification

Automated checks cover determinism, distribution, bounds, hazard/recovery/stale semantics, unchanged default limits, HTTP parity, actual CLI and an official MCP SDK client over stdio. Browser checks cover all five steps, actual map playback, pause/seek, desktop/mobile reflow and automated accessibility. Final production evidence is recorded in WORKLOG. Physical hardware and the illustrative event model are not validated by these checks.

November 8 clock separation: Configure/Play/Restart/speed and the fictional-device minute slider are now inside the Simulations workspace, not floating over the map. Leaving setup pauses simulation playback at the selected frame. Map timelines are reserved for API weather: Wind/Rain forecast use Open-Meteo hours; Rain radar uses NOAA observation history. Neither weather timeline advances fictional or connected-device readings. See PUBLIC_WEATHER_NEWS.md.
