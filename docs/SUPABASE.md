# Supabase setup

CLI configuration is initialized in `supabase/config.toml`. No application tables or hosted project have been created yet. Choose the application data model before adding migrations.

## Hosted backend

The setup owner must authenticate with `supabase login`, then inspect `supabase orgs list` and `supabase projects list`. Use a dedicated hackathon organization so teammates do not gain access to unrelated projects. Select the Free plan for a new hackathon organization; do not upgrade billing as part of this starter.

Create the project named `utd-hackathon-26` in that organization, choose a nearby supported region, and save the generated database password in your password manager. Record the project reference and dashboard URL here once created.

Link the local checkout to that hosted project:

```sh
supabase link --project-ref YOUR_PROJECT_REF
```

Copy `.env.example` to `.env`, then fill in the project URL and publishable or legacy anon key from the dashboard. The service-role/secret key is for trusted server code only. Never use it in browser code.

## Team access

Invite the two currently approved teammates with the Owner role from the dedicated hackathon organization's Team settings, using their Supabase account emails. The team requested full access to the hackathon resources. Leave UhhSaif out until the owner requests otherwise. Keep emails out of this repository.

Organization-level access applies to all projects in that organization. Project-scoped roles require a supported paid plan, so a dedicated organization keeps this starter isolated without an upgrade. Verify each invite is accepted.

Reference: [Supabase access control](https://supabase.com/docs/guides/platform/access-control).

## Local backend

Install and start Docker, then run:

```sh
supabase start
```

This downloads local containers on first use. Use the local URL and keys printed by the CLI only in local `.env`. `supabase stop` shuts down local services. Each teammate's local database is separate from the shared hosted project.

## Schema workflow

```sh
supabase migration new describe_change
# Edit the generated SQL migration and review it with a teammate.
supabase db push --dry-run
# Apply only after checking the linked project and planned changes:
supabase db push
```

Enable row-level security on exposed application tables and define policies for intended access. Test with the public client key and the appropriate signed-in users. Keep migrations in Git; coordinate changes before applying them to the shared backend.

Reference: [Supabase CLI](https://supabase.com/docs/reference/cli/introduction).
