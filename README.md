# UTD Hackathon 26

Team workspace for UTD Hackathon 2026: four people, one focused MVP, one reliable demo.

**Status:** repository starter with MongoDB selected for data storage. The project idea, application framework, and application are not defined yet.

## Start here

1. Agree on the problem, target user, and one demo journey in [the MVP plan](docs/MVP.md).
2. Assign one owner per workstream in [the team guide](docs/TEAM.md).
3. Pick the stack, add its exact install/run/test commands below, and commit a dependency lockfile.
4. Create small issues, work on branches, and request one teammate's review before merging.
5. Deploy a working vertical slice early. Rehearse using [the demo guide](docs/DEMO.md).

## Local setup

This starter needs Git. The optional publishing helper needs Python 3.9+ and the GitHub CLI (`gh`). No application dependencies are installed yet.

After publication, clone the repository using its GitHub **Code** menu. See [CONTRIBUTING.md](CONTRIBUTING.md) for the daily workflow.

| Application command | Team action |
| --- | --- |
| Install dependencies | Record after selecting the stack |
| Run locally | Record command, port, and required environment variables |
| Test | Record the actual test command |
| Build | Record the production build command |
| Deploy | Record provider, project owner, and deployment URL |

Copy `.env.example` to `.env` only when your application needs it. Keep credentials out of the repository and client bundles.

## Publish to GitHub

Authenticate with `gh auth login` if needed. Preview creation of a private repo:

```sh
python3 scripts/publish.py YOUR_GITHUB_USERNAME/utd-hackathon-26
```

The default collaborators are `dnpatel2311` and `Abasheer-rion`. Invitations for `UhhSaif` are deferred. Add `--apply` to execute. Explicit `--collaborator USERNAME` flags replace those defaults. The helper publishes this Git checkout, configures labels, seeds six issues, and sends collaborator invitations. Invites require acceptance. `--public` explicitly selects a public repo. Review visibility against the event's actual submission requirements.

You can rerun after supplying the remaining usernames. It does not push commits after initial publication; use `git push` for later changes. It refuses to attach to an existing remote repository without a matching local `origin`.

## Included

- Four-person team guide, MVP plan, architecture notes, demo and submission checklists.
- Task and bug issue forms, pull request template, labels, starter issue seeding.
- Baseline CI for tracked whitespace errors and publishing-helper syntax; Dependabot for Actions.
- Environment template, ignore rules, editor settings, contribution and security guides.

CI does not test an application yet. Extend it with your chosen stack's lint, test, and build commands.

## Project links and credits

Fill in: live demo, submission page, demo video, screenshots, third-party APIs/assets, and dependencies. Record what was built during the event versus reused material. Choose a license together before allowing reuse; no open-source license has been applied to this starter.

## MongoDB backend

Use MongoDB Atlas for the shared database. See [MongoDB setup](docs/MONGODB.md) for Atlas provisioning, full team access, connection settings, and verification. The hosted cluster and invitations are pending Atlas account access.

For optional local development, start Docker and run:

```sh
docker compose up -d mongodb
docker compose exec mongodb mongosh --quiet --eval 'db.runCommand({ ping: 1 })'
```

The local database is available only on `127.0.0.1:27017` and persists in a Docker volume. It has no authentication and is intended only for local synthetic demo data. Use `.env.example` as the server's local configuration template. Stop it with `docker compose down`.

## Cloudflare starter

Framework-neutral placeholder pages and a health function are prepared. Run `npm ci`, then `npm run dev`; use `.dev.vars` for local Pages Functions runtime settings. `npm run build` compiles the function. See [Cloudflare setup](docs/CLOUDFLARE.md). Hosting and provider credentials remain pending, and deployment is disabled by default. No product frontend framework is fixed by this starter.

## Project logs and handoff

Read [current context](docs/PROJECT_CONTEXT.md), [work log](docs/WORKLOG.md), [decisions](docs/DECISIONS.md), [hardware constraints](docs/HARDWARE.md), and [development plan](docs/DEVELOPMENT.md). [Team contacts](docs/CONTACTS.md) are for this private repository only. Update logs after meaningful work and preserve uncertainty. Never include credentials.
