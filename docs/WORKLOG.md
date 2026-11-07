# Work log

Use America/Chicago for dates and times. Append meaningful changes; do not invent timestamps. Distinguish user requests, proposals, directly verified facts, completed work, and blockers. Never log secret values or access-bearing links.

## November 7, 2026 — initial concept and research

1. In the referenced Smart Fridge Hardware Plan conversation, Ayan described a magnetic fridge device with a display, grocery scanning, inventory, expiration dates, nutrition, and ingredient-based recipe generation. That earlier assistant proposed Pi 4, touchscreen, camera, power, and storage. Hardware was proposed, not reserved.
2. Ayan asked for all HackUTD tracks, including company/business tracks and MLH categories. Public 2026 site still showed tracks pending. Beginner was mentioned, but hardware/startup and sponsor challenge availability were not confirmed. MLH's 18 general categories were found; these were not verified as HackUTD-specific. Older-year categories must not be treated as current eligibility.
3. Compared Pico/Pico 2 with Pi 5; recommended Pi 5 for the touchscreen/camera prototype. Zero 2 W was discussed as smaller, with constraints. No purchase or reservation followed.
4. Inspected HARP through Ayan's existing Chrome session. Checked main pages: home, directory, hardware inventory, team hardware requests, scan, schedule, notifications, profile, FAQ, and Hacker Pack container. Embedded Hacker Pack content did not load. Directory was paginated; individual attendee profiles were not exhaustively opened. No hardware requests existed for the team when inspected.
5. Observed authenticated JSON responses for schedule and notifications. Unauthenticated schedule request returned 401. Confirmed browser-based reading works; no independent headless session, persistent monitor, or API credential was installed.

## November 7, 2026 — product direction challenged

6. Discussed fridge memory, equipment monitoring, and shared-fridge management as possible 24-hour builds. Any future moat based on histories or integrations was speculative, not established market evidence.
7. Ayan challenged the fridge magnet: a phone could replace it, and its value/problem size seemed weak. Agreed this is a valid concern. Shifted brainstorming toward hardware that measures continuously: leaks, motor vibration/temperature, and cold-storage temperature/door monitoring.
8. Cold storage and equipment monitoring were suggested for exploration. Neither was selected. No customer validation, failure-prediction accuracy, food-safety compliance, or commercial moat was proven.

## November 7, 2026 — infrastructure starter

9. Ayan requested Cloudflare setup, basic pages, API credentials, and integration with Adyaan's existing GitHub/Supabase setup, without fixing the product design.
10. Found invitation to `AdyaanAkram/utd-hackathon-26`; CLI and browser could access it. Inspected README, team/MVP/architecture guidance, Supabase starter, and CI. Repository contained no product application. Supabase hosted project and team access were documented as pending.
11. Cloned the personal starter locally. Created `feat/cloudflare-starter`, commit `1220977`, and draft PR #8. Added static home/status/404 pages, `/api/health`, pinned Wrangler 4.158.0, environment examples, build checks, deployment documentation, and deployment workflow gated by `CLOUDFLARE_DEPLOY_ENABLED=true`.
12. Verification: Pages Function compiled; local home/status/health returned 200 and unknown path 404; credential sentinel values were absent from health output. Both GitHub CI jobs passed. No hosted deployment was made. Original health endpoint used Supabase configuration flags; newer local MongoDB revision supersedes that proposal.
13. Cloudflare dashboard required login. Signed-in Supabase account showed only an existing personal organization; team hosted project was not identified. No paid services, credentials, invitations, database schema, or production settings were changed.

## November 7, 2026 — organization, MongoDB, credentials

14. Found newer invite to `hackathon26UTD` from GitHub user `aa3264`. Membership initially pending, later verified active/admin. Four team handles appeared in the organization. No organization repositories were visible when checked. Do not infer the final repo name.
15. Ayan explicitly replaced Supabase with MongoDB. Prepared local branch `feat/mongodb-cloudflare-starter` with MongoDB-oriented environment examples/status wording and setup guidance. This revision has not been deployed or published into the organization. Existing Supabase source files are historical starter material; no hosted service was removed.
16. Asked whether API meant app backend endpoints or management credentials. Ayan clarified: MongoDB API key in `.env`, plus GitHub and Cloudflare APIs, broad/all-access with no expiration. No product API endpoints beyond the health check are requested by that clarification.
17. Reused current GitHub CLI credential in an ignored local `.env` with permissions 0600; verified Git ignores it and the authenticated GitHub API returned 200. No token value was printed. MongoDB/Cloudflare fields remain empty. Expiration of the existing GitHub credential was not independently verified.
18. Inspected MongoDB Atlas: signed in to older personal organization `Ayan's Org - 2024-10-25`, Project 0, no cluster. Organization user role showed Organization Owner. Opened identity/access pages read-only. No administrative API key or database user created; no access-list weakening performed.
19. Ayan requested persistent Markdown history: work logs, contacts/emails/handles, tech stack, goals, development plan, hardware constraints, and decisions, to add to the final repository when available. Prepared these documents locally, excluding secrets. Do not claim that the organization already contains them.

## Open blockers

- New organization PR needs review/merge; old personal PR remains unmerged.
- Intended Atlas organization/project must be confirmed.
- Cloudflare sign-in incomplete.
- New privileged persistent credentials require final confirmation under the browser tool's security-access rule.
- Product choice, hardware reservation, final tracks, and team ownership remain undecided.

## November 7, 2026 — organization repository available

20. The private `hackathon26UTD/utd-hackathon-26` repository became available with admin access. Its latest inspected commit was `2fcd2f0` (MongoDB setup), with local Docker Compose and revised CI already present. Used a fresh clone after the earlier local checkout reported a malformed duplicate Git reference. Preserved the original local files and the teammate's new MongoDB/Compose changes.
21. Prepared `feat/cloudflare-project-logs` in the organization repository. Added the Cloudflare starter with MongoDB health flags, management credential placeholders, and project/history/contact/hardware/development Markdown. Preserved existing MongoDB settings and appended updates to teammate documents. Moved the private ignored local `.env` into the new local checkout; no credential values were committed.

## November 7, 2026 — API priority and MongoDB ownership

22. Ayan prioritized credentials over finishing the documentation PR. Documentation and starter changes remain local on `feat/cloudflare-project-logs`; no organization PR has been published yet.
23. Ayan clarified that Adyaan is provisioning MongoDB. Stop MongoDB administrative credential creation. The earlier personal-organization key form was prepared but never submitted; no key was created.
24. Focus is GitHub and Cloudflare credentials in the local hackathon `.env` until team MongoDB access exists. Verified existing GitHub credential is present, local file permissions are 0600, and Git excludes the file.
25. Tried Cloudflare sign-in with Ayan's personal Google account and current GitHub account. Both returned “Your account uses a different login provider.” No Cloudflare credential was created. The browser is left at sign-in for the user to complete with the original login method. No OAuth callback URLs or credentials are stored in these logs.

## November 7, 2026 — signed-in Cloudflare and team Atlas

26. Ayan reported Cloudflare sign-in complete and requested a hands-off workflow that prioritizes CLI/APIs, using Chrome to establish access when necessary. Confirmed Cloudflare account is signed in. Existing user API tokens were listed; no token was rotated or created.
27. Confirmed Adyaan's hackathon Atlas project and Free cluster are active. Added only this computer's current public IPv4 `/32` through Atlas's “Add Current IP Address” control, as requested. Portal confirmed the entry; cluster changes were being deployed. No broad IP range was added. Connection itself remains untested.
28. Saved non-secret Cloudflare account/email and new Atlas organization/project identifiers into the ignored local `.env`. GitHub credential remains present. No MongoDB management credential was created.
29. Started Cloudflare's existing Global API Key reveal flow, requested verification email, and entered its code without storing it in project logs. Cloudflare then required a CAPTCHA. Browser policy requires action-time approval for completing it; requested approval and left the concrete human-check prompt open. No Cloudflare key has been retrieved yet.

## November 7, 2026 — API access verified

30. Ayan approved completing the Cloudflare human-check checkbox and saving the existing API key to the ignored hackathon `.env`. Completed the check, revealed the existing Global API Key, saved it locally as `CLOUDFLARE_API_KEY` with `CLOUDFLARE_EMAIL` and account ID, then closed the key dialog. No new key was created or rotated; no new permission was granted to a token. Do not record the key or verification code here.
31. Verified Cloudflare account access through its REST API with HTTP 200, and GitHub organization-repository admin access through its REST API with HTTP 200. The local `.env` remains 0600 and excluded by Git. These API checks are read-only. GitHub credential expiration is still not independently established.
32. Authentication priority is CLI/API first, Chrome for setup or missing API capabilities. Use these existing local credentials without repeatedly asking for authorization already provided. Action-time browser checks still apply where explicitly required. Cloudflare token/key values have not been shared with teammates, uploaded to GitHub Actions secrets, or saved in MongoDB.

33. Published the starter and persistent Markdown logs as draft PR https://github.com/hackathon26UTD/utd-hackathon-26/pull/8, commit `34378a4`. This is the organization PR; the earlier personal-repository PR also happens to be numbered 8 and remains separate/unmerged. Credential values remain local and were checked against tracked files. The organization PR is not merged and has no hosted deployment.

## November 7, 2026 — MongoDB application and CI/CD

34. User requested starting MongoDB work, pushing PRs, and ensuring CI/CD. Inspected the current organization PRs and found #8 conflicting with newer teammate changes on main. Integrated those changes, preserving Atlas resource details, Compose settings, team access notes, and ignore rules. Marked PR #8 ready for review and pushed the resolved branch; no PR was merged.
35. Prepared database user `hackathon26-app`, scoped to `readWrite` on `utd_hackathon_26`. User explicitly approved creating it, saving credentials locally/in Cloudflare, and adding `0.0.0.0/0` for Cloudflare's changing outbound IPs. Created the user and network entry, retained password/TLS authentication, and kept secret values out of logs.
36. Verified Atlas ping, isolated insert/read/delete, and readiness through the actual local Cloudflare runtime. Added request-scoped MongoDB connections and `/api/ready`, with generic failure responses that do not reveal driver errors or credentials. Product-specific data APIs remain undecided.
37. Created free Pages project `utd-hackathon-26` and encrypted MongoDB runtime settings. Created a separate non-expiring account-scoped Pages Write token for GitHub Actions, retaining the existing global key locally. GitHub Actions deployment secret and account/enable variables are configured.
38. CI now runs unit/privacy tests, isolated MongoDB integration, and function compilation before deployment. The initial newer-runner MongoDB service failed due to the documented kernel incompatibility; pinned its check job to Ubuntu 22.04. Node compatibility must be explicit for this Wrangler bundler.
39. CI/CD run 42414675900 passed build/tests/upload, but live inspection exposed a missing plain-text database-name setting in preview. Moved that setting into tracked Wrangler config and added live readiness verification to the deploy script, so future CI/CD cannot pass merely on upload success. Latest runs are the live authority; secrets are not logged.
40. Closed the earlier personal-repository PR #8 as superseded by the organization PR #8. Organization Dependabot PR #1 was inspected and has a passing starter check; it remains a separate unmerged PR.
41. Git writes in the Documents checkout encountered syncing/index timeouts. Used a separate active checkout linked from `work/active-repo`, retaining the canonical private env files in the persistent project folder. No teammate edits were reverted.

## November 7, 2026 — home disaster black-box direction

42. User described the current idea: a house black box targeting State Farm and other tracks, sensing power/network degradation, air quality and possible water/flooding, running local inference/logging, shedding nonessential loads on battery, and feeding a regional response map with weather overlays. Asked what the risk means to an insurer and how to sharpen the concept.
43. Recorded HOME_BLACK_BOX.md and updated current context, MVP and decisions. Proposed framing: explainable response priority for possible active/worsening property damage, with separate observation freshness and device endurance. Claims timelines are supporting observations, not automatic coverage/payout decisions. Evacuation needs an explicit source; offline is unknown, not safe.
44. Flagged the core engineering dependency: battery backup does not replace failed home internet. Proposed a 24-hour power-loss/water/offline-replay demo; real fallback connectivity, AI and weather overlays are stretch goals unless already working. Actual battery endurance, fire/flood sensing accuracy and physical survivability are unverified.
45. Public Devpost could not be read with the web tool, so the exact current State Farm challenge remains unverified. State Farm's own catastrophe-claims page confirms that it mobilizes response teams; property-level prioritization is our proposed application, not an established integration or promise of emergency dispatch.

## Imported teammate API notes

## November 7, 2026 — team API layer (Dhruv, branch `feat/core-api`)

34. Built a product-agnostic API on top of `feat/cloudflare-project-logs` so hardware and software work can start before the product is chosen: devices + per-device keys, `/ingest`, readings (history, latest, chart stats), rules → alerts, events, and a generic `/store/:collection` document store. Replaced the config-only `/api/health` with a real MongoDB ping. Added `nodejs_compat` (needed by the MongoDB driver) to `wrangler.jsonc` and the build script.
35. Verification: `npm test` passes 9 end-to-end tests against an in-memory MongoDB, including the per-request MongoClient path used on Cloudflare. `npm run dev:local` ran the real Pages runtime (workerd) against a local mongod; health ping, device registration, rule-triggered alert, latest readings, and store writes all succeeded. `npm run build` succeeds.
36. Not yet verified: Atlas connectivity from Cloudflare (needs an app DB user, `0.0.0.0/0` network access, and Pages secrets), and the ESP32 sketch on real hardware (it compiles in principle but was not flashed). See docs/API.md deploy checklist.

## 2026-11-07 HomeBeacon command center and account access

Built the map workspace, public exercise, real device summary endpoint, public disaster source endpoint, operator session login, basic profile, password change and single-use recovery. Added privacy, terms, cookie and accessibility pages. Adapted the actual public Argus Oracle component patterns with Geist and Bricolage typography. Added no analytics. Seven public routes pass automated WCAG A/AA checks; manual accessibility and legal review remain outstanding. User authorized merging project PRs. Hardware still belongs to Dhruv; synthetic exercise readings do not represent a connected physical device.
