# MongoDB setup

The team selected MongoDB Atlas for the shared backend. Hosted resources and invitations have not been provisioned yet. The optional local database is configured in `compose.yaml`.

## Shared Atlas environment

Use a dedicated organization named **UTD Hackathon 26** and a project named **utd-hackathon-26**. Create a **Free** cluster named **utd-hackathon-26** in a supported nearby region. Do not select a paid tier or upgrade billing as part of this starter.

Record the organization ID, project ID, cluster name, and dashboard link here after creation. Do not store credentials here.

## Full teammate access

The owner requested full access for `dnpatel2311` and `Abasheer-rion`. Invite their provided Atlas account emails with **Organization Owner** in this dedicated organization. That role gives full management of the hackathon organization and its projects. Invitations for `UhhSaif` remain deferred. Keep teammate email addresses out of source control.

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
