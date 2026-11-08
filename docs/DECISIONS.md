# Decision register

## November 7, 2026 — system intelligence and actual pickup

- User requested Nemotron beyond chat, related sensor evidence, black-box checkpoints, power/Wi-Fi behavior and battery goals. Built additive operator APIs and a bounded tool workflow on the existing MongoDB model, preserving teammate UI/firmware.
- User explicitly chose a **labeled simulator for now**. Missing NVIDIA credentials must never silently yield simulated success. Real sponsor integration remains to be verified.
- Cloud inference proposes a review checkpoint; local deterministic code owns essential sensing/alarms/recording. Hardware application is not implemented by this backend branch.
- 24-hour endurance is a design goal, not a measurement. Runtime remains unknown without explicit energy/current assumptions; one battery budget is assigned to one box.
- The supplied HARP screenshot verifies pickup of visible items including one AA holder. Earlier draft quantities/status are historical. Model of the power module, cell capacity and safe seamless switchover remain unverified.

Updated November 7, 2026. Proposed items are not commitments.

| Topic | Current position | Status / history |
| --- | --- | --- |
| Product | House disaster black box / incident recorder | User selected this direction for planning; fridge magnet is superseded. See HOME_BLACK_BOX.md. |
| Hardware requirement | Must have a meaningful sensing/physical role if chosen | Cold storage, equipment monitoring, and leak sensing discussed; none selected. |
| Database | MongoDB | Explicitly replaces Supabase. No hosted resource deletion requested or performed. |
| Hosting | Cloudflare | Requested; starter prepared, login/deployment pending. |
| GitHub ownership | hackathon26UTD organization | Membership active/admin; private `hackathon26UTD/utd-hackathon-26` is now available. Earlier personal repo is historical. |
| Frontend | Undecided | Current placeholder uses HTML/CSS/JavaScript, not a final product framework. |
| App API | Undecided | Latest API request means management credentials, not a product API specification. |
| AI provider | Undecided | Recipe generation and anomaly detection were suggestions, not selected integrations. |
| Credential preference | Broad privileges, no expiration requested | Actual issuance depends on service/account support and final creation confirmation. GitHub existing credential reused locally; MongoDB/Cloudflare credentials pending. |
| Credential storage | Local ignored `.env`; hosting secrets when deployed | No token values in docs, source, browser bundles, database collections, or chats. Team sharing not configured. |
| Deployment mechanism | Direct Upload + GitHub Actions proposed | Not deployed; native Git integration remains an alternative. Switching Direct Upload to native Git integration requires another Pages project. |
| Track eligibility | Unconfirmed beyond public Beginner mention | MLH general prize catalog and older-year categories are not proof of 2026 event eligibility. |
| Documentation | Append meaningful work and decisions to Markdown | Include contacts, verified status, constraints, reversals and blockers; never credentials. |

## Questions to resolve

- Who is the target user and what repeated costly problem are we solving?
- What can hardware observe that the user's phone cannot reliably observe?
- Which organization repo and Atlas project are authoritative?
- Which of the actual 2026 tracks permit this project, and how many may be entered?
- Which teammate owns frontend, backend/data, hardware, and integration/demo?

## Home black-box planning update

User-proposed goals: power/network loss, air quality, moisture/water, local inference/logging, battery conservation, regional map and weather context. Recommended framing is response priority based on observed hazards and information freshness, not a calibrated insurance risk/payout score. A working fallback network is required for live reporting when home internet fails; otherwise use honest offline replay. Critical sensing/logging should not depend on AI availability.
