# Security and credentials

Commit only placeholder configuration. Keep real credentials in local environment files, GitHub Actions secrets, and deployment secret settings. Frontend code and browser-exposed environment variables are public to visitors.

If a secret is exposed, revoke or rotate it immediately. Deleting the latest file does not remove it from Git history. Notify the repo owner privately and review its usage logs.

Report security concerns privately to the repository owner through a channel already agreed by the team. Do not put tokens, private user data, or exploit details into public issues. Use synthetic data in the demo unless you have permission to use real data.
