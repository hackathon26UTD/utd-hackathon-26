# Architecture and decisions

Fill this out as the team chooses a stack. Keep it short and actionable.

| Decision | Choice | Reason / owner |
| --- | --- | --- |
| Frontend | Undecided | |
| Backend | Undecided | |
| Data storage | MongoDB Atlas Free | Running shared cluster in AWS US_EAST_1; see MONGODB.md |
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
