# Nemotron operator demo

Safe Home connects recorded observations to a reviewable next action. The device collects data; the server-hosted Nemotron model reads bounded evidence through tools. The model does not run on the ESP32 or prove that a hardware action happened.

## Three minutes, four presenters

1. **0:00–0:30 — the problem.** During a widespread disruption, an operator has scattered readings and limited time. Introduce one home with water/power observations and another with an unconfirmed flame signal. Identify real bench data versus synthetic exercise data before showing either.
2. **0:30–1:15 — the review queue.** Open **Review**. Show the review reasons, timestamps and gaps. Run Nemotron on the displayed shortlist. Expand the actual tool actions and citations. Review order follows explicit rules; Nemotron explains the evidence and unknowns. A partial scan is not a ranking of every home.
3. **1:15–2:10 — investigate one home.** Open a listed device's **Conditions**. Run the investigation and inspect sensor cross-checks. A positive flame proxy with missing smoke corroboration remains a concern requiring review; it does not become a confirmed fire or a false alarm. Show the cited records and the original observation times.
4. **2:10–3:00 — prepare the handoff.** Open the responder brief, which separates recorded facts, model interpretation, unknowns and proposed follow-up. Copy or download it. Show the power policy: battery runtime is unknown without an energy/draw budget, and any supplied estimates remain labeled. Finish with the saved checkpoint.

Keep the actual model tool actions visible, not a fabricated progress animation. If inference fails, show the error and deliberately choose the **Simulator** for an exercise; say that it is scripted and not NVIDIA inference. No demo action dispatches responders, contacts vendors or changes the box's hardware settings.

## Reproducible local evidence

`npm run review:demo` creates disposable local MongoDB data for five fictional homes: water/power, an unconfirmed flame reading, an old critical observation, recent reports, and no sensor reports. It runs the explicit simulator, saves/reads back a fleet checkpoint, and checks a device brief. It never connects to production Atlas.

`npm run review:demo -- --nvidia --output /private/tmp/safehome-review-demo.json` runs the same fictional dataset through the configured NVIDIA server. Only the NVIDIA variables are loaded from the ignored local environment. The artifact identifies synthetic observations and real inference separately. The runner closes its database after completing.

## Questions to be ready for

- **Why use Nemotron?** It follows a tool workflow to read recorded context, inspect relationships and gaps, and save a concise, cited work product. Calculations, scope, supported actions and review order remain deterministic and inspectable.
- **Does “offline” mean safe or evacuated?** No. It means current conditions are unknown. Prior unresolved concerns remain visible.
- **Is battery life verified?** Only an actual measured endurance run establishes endurance. The app's formula and optional measurements/assumptions are a projection.
- **Does this predict damage or approve claims?** No. It supports human review of observations. It does not determine occupancy, safe entry, insurance coverage or claim eligibility.
- **What works without internet?** Firmware recording and networking require their own physical tests. Cloud inference waits for data to reach the server. Do not use a web simulation as evidence of physical outage resilience.

Current deployment and verification evidence is in [WORKLOG](WORKLOG.md). The implementation contract is in [System intelligence](SYSTEM_INTELLIGENCE.md).
