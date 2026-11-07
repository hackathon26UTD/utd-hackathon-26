# MongoDB setup

The team selected MongoDB Atlas for the shared backend. The free cluster is running and a database statistics command returned `ok: 1`. Teammate Owner invitations are awaiting acceptance; application credentials and client IP access remain to be configured. The optional local database is configured in `compose.yaml`.

## Shared Atlas environment

| Resource | Value |
| --- | --- |
| Organization | Adyaan's Org - 2026-11-07 |
| Organization ID | `6aef85bf7e6ae4b2af6a2bed` |
| Project | `utd-hackathon-26` |
| Project ID | `6aef85f3b64186873a7b77ad` |
| Cluster | `utd-hackathon-26` — Free |
| Region | AWS `US_EAST_1` (Northern Virginia) |
| Server version at setup | `8.0.37` |
| SRV host | `utd-hackathon-26.md5fla8.mongodb.net` |

This organization was newly created and had no listed projects when setup began. The hackathon project is separate from the default Project 0 created during onboarding. Use the Free cluster; no paid upgrade is configured. Do not store credentials here.

## Full teammate access

The owner requested full access for `dnpatel2311` and `Abasheer-rion`. On November 7, 2026, Atlas showed pending **Organization Owner** invitations for both teammates' provided account emails. Each teammate must accept the invitation to activate access. That role gives full management of the hackathon organization and its projects. Keep teammate email addresses out of source control.

Atlas account access and database access are separate. Each teammate who connects through a driver, Compass, or mongosh also needs a database user and an allowed network address. Give human administrators the database access needed for their work. Give the application its own database user with `readWrite` on `utd_hackathon_26` rather than using a human administrator's credentials.

References: [Atlas roles](https://www.mongodb.com/docs/atlas/reference/user-roles/), [organization invitations](https://www.mongodb.com/docs/atlas/access/manage-org-users/).

## Connect the backend

1. Add the actual development or deployment egress addresses to the project's Network Access list.
2. Create the application's database user.
3. Copy the connection string from Atlas's **Connect** flow.
4. Copy `.env.example` to `.env` and replace `MONGODB_URI` with that connection string. Set the database name to `utd_hackathon_26`. Percent-encode special characters in the username and password.
5. Store the same variables in the server hosting environment's secret settings. Never include the URI in browser code, screenshots, commits, or logs.

MongoDB is the database. Pick end-user authentication separately if the app needs accounts. Access it through the server, using the official driver for the chosen language, and reuse a pooled client.

Reference: [Connect to Atlas](https://www.mongodb.com/docs/atlas/connect-to-database-deployment/).

## Verify the shared database

Use Atlas's **Connect → Shell** command, specifying the database username and letting mongosh prompt for its password. Once connected, run:

```javascript
db.runCommand({ ping: 1 })
```

Expect `ok: 1`. After defining the data model, verify a write and read using the application's own database user. MongoDB creates databases and collections on the first write, so an empty database may not appear in the UI yet.

## Optional local database

With Docker running:

```sh
docker compose up -d mongodb
docker compose exec mongodb mongosh --quiet --eval 'db.runCommand({ ping: 1 })'
```

Connect the local server to `mongodb://127.0.0.1:27017/utd_hackathon_26`. This is an unauthenticated development database bound to your computer's loopback address; use synthetic data. It is separate from the team's Atlas cluster. The named volume preserves data between restarts. `docker compose down` stops it without deleting the volume.

Reference: [MongoDB's official Docker image](https://www.mongodb.com/docs/manual/administration/install-community-docker/).

## Management credentials and latest request (November 7, 2026)

Ayan requested Atlas administration credentials, plus GitHub and Cloudflare API credentials, in an ignored local `.env`, with broad privileges and no expiration where supported. No Atlas administration key has been created. The signed-in account currently shows an older personal organization; confirm the dedicated hackathon organization before credential creation. Actual scopes and expiration must be reported, not assumed.

An Atlas administration API key manages Atlas infrastructure and does not grant direct reads/writes of application collections. Database users and `MONGODB_URI` remain separate. No credential values belong in Markdown, source, or client bundles. See PROJECT_CONTEXT.md and WORKLOG.md for verified state.
