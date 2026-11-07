# Research notes and limitations

As checked November 7, 2026. Recheck all event rules, stock, and categories before acting.

## Track research

The 2026 official page showed company and organizer track tabs, “Enter up to two,” and a message that challenge tracks would be announced when hacking starts. Beginner was mentioned in the FAQ. The full current list was not retrieved. HARP linked the current Devpost: https://hackutd-zeroday.devpost.com/. That page is a better next source than older-year results; its prizes have not yet been inspected in this chat.

The schedule showed T-Mobile, PNC, 8090, NMC, EOG, Goldman, Capital One, AT&T, and Spacetime activities. Activity/sponsor presence is not confirmation of a challenge track or prize.

MLH's general prize page listed 18 categories: SpaceXSI A-Team raffle; Best Use of Gemini API; ElevenLabs; Entire; Solana; Tiger Data; Gen AI; Presage; Backboard; Vultr; Commit Fellowship; DEV Writing Challenge; DigitalOcean; Snowflake API; Auth0; MongoDB Atlas; Best .Tech Domain Name; Best Domain Name from GoDaddy Registry. These are the general catalog, not verified HackUTD entries. Commit Fellowship was the business-oriented option described there.

Best Startup and Hardware appeared in older-year HackUTD results. They must not be called confirmed 2026 tracks. Earlier conversation recommendations presumed a hardware track without verifying the 2026 rules; this is an open issue.

Sources: https://zeroday.hackutd.co/, https://hack.mlh.io/, https://www.mlh.com/events/hackutd-ae (2025, historical only).

## HARP automation

The signed-in Chrome session can read page text automatically without screenshots. Observed successful JSON responses included `/v1/schedule`, `/v1/schedule/date-range`, `/v1/schedule/tags`, `/v1/directory/status`, and `/v1/notifications/feed`. A request to `/v1/schedule` without authentication returned 401. These observations do not establish a supported public API, token access, push subscriptions, or a standalone headless login. No background monitoring was enabled.

Hacker Pack container linked https://hackutd-2026.notion.site/3b163cec774080bea6c5fb7358a42dac, but its embedded document did not load. No rules were inferred from the blank embed.

## Startup/problem discussion

The strongest proposed direction was hardware that continuously observes conditions while a phone is absent: cold storage, equipment behavior, or leaks. Food-waste scanning effort and phone substitution were explicit objections to the original magnet. Any moat based on unique labeled histories, customer workflows, integrations, or outcome data is a possible future advantage, not something demonstrated by the hackathon prototype. Customer urgency, willingness to pay, accuracy, and differentiation remain unvalidated.

## Database/cloud integration

Atlas Administration API keys manage infrastructure and do not grant application data access: https://www.mongodb.com/docs/atlas/api/api-authentication/. Runtime MongoDB access requires database credentials and networking. Cloudflare supports native MongoDB drivers, but connection lifecycle needs runtime-specific handling: https://developers.cloudflare.com/workers/tutorials/connect-to-mongodb-atlas/ and https://developers.cloudflare.com/workers/databases/third-party-integrations/mongodb/. No Atlas connection has been tested in this project yet.
