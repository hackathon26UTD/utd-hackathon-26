# Public website and portal

Current as of November 8, 2026. Owner: Ayan's workstream. Code: `ui/marketing.js`, `ui/marketing.css`, `ui/display-settings.js`.

## Current flow

The public root introduces HomeBeacon. The hero has one command-center action and a separate account link. Sign-in remains a separate route; `/portal` chooses the authenticated workspace or login. Customers create their profile before adding a device and its address.

The homepage map is a non-interactive simulated overview, not a second command center. The same-origin demo embed has inert keyboard/pointer access and disables MapLibre interaction and navigation controls. One caption identifies the simulation. Power, Wi-Fi and Conditions are the only three summaries beneath it. The normal example says “No disaster or disturbances detected.” That wording describes the example only, never missing live observations.

The preview cycles normal, power loss, water/hurricane and recovery every 6.5 seconds. Pause/Play controls the sequence. It stops when offscreen, the page is hidden, or reduced motion is requested. Lower-power/recovery examples retain unresolved water reports. The full `/demo` and operator command map remain interactive.

The remaining sections explain first-responder follow-up, local recording and power conservation, prototype hardware, the four-person team, event, services and account access. Event attribution lives in About rather than repeated hero labels. The [official event site](https://zeroday.hackutd.co/) confirms HackUTD 2026: Zero Day, November 7–8 at UTD. The GitHub link is marked as requiring repository access because the source remains private. No unverified sponsor-track claim is made.

## Design and controls

Use self-hosted Geist, white/neutral surfaces, green actions and the existing dark kit theme. Comfortable spacing and section rules replace decorative pill labels and stacked boxes. Controls have small rounded corners; tabs remain tabs. The actual vendored Argus kit supplies dropdowns and command navigation; see UI_KIT.md and ui/kit/PROVENANCE.md.

Settings sits at the upper right on both the homepage and command center. Theme and Motion use real Kit.select controls. Choices persist in browser storage and synchronize across the preview frame and other open pages. The 196/64px command sidebar animates its width and labels together in 280ms. Reduced motion removes these transitions.

MapLibre/OpenFreeMap render the preview, so marketing does load a map. Map and open-source attribution remain visible. Public service descriptions distinguish contextual observations from verified household conditions.

## Limits and verification

Battery endurance, automatic firmware power saving, offline replay and physical sensor-to-production delivery still need hardware testing. First-responder support is the intended review workflow, not automatic dispatch. Demo observations are fictional. The site does not establish certification, safe entry or damage certainty.

Run the build and existing test suite, then check the homepage in installed headless Chrome: scenario progression and pause, reduced motion, theme synchronization, 320/390px layout, settings keyboard operation, and sidebar animation. Automated accessibility checks are useful but separate from manual screen-reader, cross-browser and legal review. See WORKLOG for this revision's actual results.
