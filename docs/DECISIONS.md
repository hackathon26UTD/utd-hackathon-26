# Decision register

Updated November 7, 2026. Proposed items are not commitments.

| Topic | Current position | Status / history |
| --- | --- | --- |
| Product | Undecided | Smart fridge magnet was initial concept; Ayan challenged phone substitution and problem strength. |
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
