# Architecture and decisions

Fill this out as the team chooses a stack. Keep it short and actionable.

| Decision | Choice | Reason / owner |
| --- | --- | --- |
| Frontend | Undecided | |
| Backend | Undecided | |
| Data storage | MongoDB Atlas | Shared hackathon database; hosted provisioning pending |
| Authentication, if needed | Undecided | |
| External APIs / models | Undecided | |
| Hosting | Undecided | |

## API / data contract

Before parallel implementation, agree on endpoint or function names, request and response examples, validation, errors, and ownership. Record where sample data lives. Mark mocked behavior clearly.

## Environment variables

Document name, purpose, whether required, and which teammate owns provisioning. Put placeholder names in `.env.example`; store real values in local environments and hosting secret settings.

The backend uses `MONGODB_URI` and `MONGODB_DB`. Keep the connection string in server-side configuration; browser code calls the backend API. See [MongoDB setup](MONGODB.md). MongoDB does not supply the application's end-user authentication flow; select that separately if the MVP needs accounts.

## Reliability

Record API limits, expected costs, timeouts, fallback behavior, and a safe demo dataset. Document where logs are visible without storing credentials or personal data here.

## Deployment and recovery

Record the deployment URL, build/start commands, required secrets, deploy owner, and how to restore the last working version. Create a demo tag once the main journey is stable.

## Cloudflare starter and current state (November 7, 2026)

Cloudflare hosting was requested; framework-neutral HTML/CSS/JS placeholders and a Pages Functions health endpoint are prepared in this branch. No deployment, frontend framework, product API contract, AI provider, or end-user auth system is selected. Wrangler is pinned to 4.158.0; CI uses Node.js 22. `/api/health` only confirms the function runs and whether MongoDB runtime variables are present; it does not test database connectivity.

Provider management API credentials are separate from the application's MongoDB connection. Their current requested scope/storage and blockers are recorded in PROJECT_CONTEXT.md. For a Cloudflare runtime, do not reuse request-bound I/O clients across requests without a supported architecture; validate driver lifecycle against Cloudflare's MongoDB documentation before applying a generic connection pool.
