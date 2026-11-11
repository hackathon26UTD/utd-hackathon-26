# Product marketing update — November 10, 2026

The marketing homepage now separates product discovery from the origin story. Navigation provides Features, The box and a dedicated `/about` page. Existing Safe Home colors, Hanken Grotesk, Argus controls, Dashboard routing and profile settings remain.

The hero retains the actual animated, simulated map and adds selectable household-dashboard and event-history illustrations. All are labeled fictional. Switching away from the map pauses its preview; existing visibility, motion and playback behavior remains. Household/history illustrations do not fetch or expose private records.

The public box explorer lazy-loads the existing customer enclosure renderer and the same CAD assets near the viewport. Visitors can drag, zoom, open/close the lid, reset the view, and select local recording, connection or sensor features using buttons or ray-picked model hotspots. Keyboard controls and all feature text work without pointer interaction. A failed WebGL load retains the text alternative. Internal components remain explicitly illustrative; endurance, replay and physical delivery are not newly verified by this website change.

The About page preserves the four-person HackUTD origin, event details, intent and service context, and explains the next chapter without invented founder biographies or launch claims. It has its own title, canonical metadata, sitemap entry and static route exclusions. It does not load the dashboard iframe or 3D renderer.

Verification commands: `npm run build`, `node test/marketing-product.browser.mjs [origin]`, and `node test/marketing-weather.browser.mjs [origin]`. The new browser check covers actual model ray-picking, lid keyboard operation, showcase switching, About navigation, 320/390/768 px layout, and scoped automated accessibility checks. See WORKLOG and PR release evidence for results.

---

## Historical homepage contract

# Public website and portal

Current as of November 8, 2026. Owner: Ayan's workstream. Code: `ui/marketing.js`, `ui/marketing.css`, `ui/display-settings.js`, `ui/home-profile.js`.

## Current flow

The public root introduces Safe Home. The hero has one command-center action and a separate account link. Sign-in remains a separate route; `/portal` chooses the authenticated workspace or login. Customers create their profile before adding a device and its address.

The homepage map is a non-interactive simulated overview, not a second command center. The same-origin demo embed has inert keyboard/pointer access and disables MapLibre interaction and navigation controls. One caption identifies the simulation. Power, Wi-Fi and Conditions are the only three summaries beneath it. The normal example says “No disaster or disturbances detected.” That wording describes the example only, never missing live observations.

The preview cycles normal, power loss, water/hurricane and recovery every 6.5 seconds. It starts automatically. Pause/Play controls both the sequence and wind motion. With reduced motion, the same control becomes Next for manual scenario changes. It stops when offscreen, the page is hidden, or reduced motion is requested. Lower-power/recovery examples retain unresolved water reports. The full `/demo` and operator command map remain interactive.

The remaining sections explain first-responder follow-up, local recording and power conservation, prototype hardware, the four-person team, event, services and account access. Event attribution lives in About rather than repeated hero labels. The [official event site](https://zeroday.hackutd.co/) confirms HackUTD 2026: Zero Day, November 7–8 at UTD. The GitHub link is marked as requiring repository access because the source remains private. No unverified sponsor-track claim is made.

## Design and controls

Use self-hosted Hanken Grotesk, white/neutral surfaces, warm red actions and charcoal dark mode, following the November 8 State Farm-inspired direction in BRAND.md. The stacked SAFE/HOME wordmark and red house are shared across marketing, signup, customer and operator screens. Centered 52px icons, equally weighted Power/Wi-Fi/Conditions columns, expanded section spacing and section rules replace decorative pill labels and stacked boxes. Controls have small rounded corners; tabs remain tabs. The actual vendored Argus kit supplies dropdowns and command navigation; see UI_KIT.md and ui/kit/PROVENANCE.md.

The homepage has separate corner controls rather than an enclosing navigation bar: brand left, What is it/About centered, boxed Sign in and avatar right. The avatar opens View profile, then Settings. Visitors choose one of four bundled cartoon avatars saved only in this browser; signed-in customer/operator photos use the existing private photo endpoints and take priority. The command center keeps its Settings menu. Theme and Motion use real Kit.select controls. Choices persist in browser storage and synchronize across the preview frame and other open pages. The 196/64px command sidebar animates its width and labels together in 280ms. Reduced motion removes these transitions.

The preview starts in a blue wind view with geographical streets, labeled illustrative speeds and downwind trails. Preset speeds are 12/30/95/18 km/h for normal/power loss/hurricane/recovery; these are illustration values, not sensor observations, and never change device assessments. MapLibre/OpenFreeMap render the preview, so marketing does load a map. Map and open-source attribution remain visible. Public service descriptions distinguish contextual observations from verified household conditions.

## Limits and verification

Battery endurance, automatic firmware power saving, offline replay and physical sensor-to-production delivery still need hardware testing. First-responder support is the intended review workflow, not automatic dispatch. Demo observations are fictional. The site does not establish certification, safe entry or damage certainty.

Run the build and existing test suite, then check the homepage in installed headless Chrome: scenario progression and pause, reduced motion, theme synchronization, 320/390px layout, settings keyboard operation, and sidebar animation. Automated accessibility checks are useful but separate from manual screen-reader, cross-browser and legal review. See WORKLOG for this revision's actual results.

The header reflows to two rows on phones, keeping the two page links centered. Settings uses real Argus dropdowns with accessible names that include the selected value. Uploaded photos remain private and uncached; the public page does not create or modify accounts. Verification command: `node test/marketing-weather.browser.mjs [origin]` after `npm run build`.

November 8 monitoring-copy update: the three centered columns now explain what the box monitors instead of displaying changing example statuses. Power describes outage checks and intended battery-backed recording; Wi-Fi describes local recording/reconnection; Conditions lists connected water, heat, humidity and alarm signals. These descriptions stay fixed while the hero illustration plays. Backup endurance and replay remain subject to the hardware evidence limits stated on the page and in HARDWARE.md.
