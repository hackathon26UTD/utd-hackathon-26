# Personal assistants and self-built boxes

Ayan's November 8 workstream. Customer-owned MCP and optional NVIDIA access are separate from operator inference, device credentials and provider-management credentials.

## Customer flow

`/build` is the public setup guide. Create an account, then use **Build your own box** on `/customer`. Enter a name, installation address and current password. The server matches the address through the existing Census integration, atomically creates a home/device/customer link, and returns a device key once. No sensor readings are seeded. Keys can be replaced only for an actively linked self-built box after password verification. Replacing a key immediately invalidates the old one. At most five boxes can be registered per account, including after an email change. Self-built reports are labeled unverified in the operator workspace.

The existing `/api/beacon/ingest` contract is unchanged. See `clients/esp32/HOMEBEACON.md`. The assistant can explain registration and ingest, but credentials are created on the website, never returned to a model. Hardware calibration, battery life, offline replay and physical delivery remain unverified.

## Remote MCP

URL: `https://utd-hackathon-26.pages.dev/mcp`.

Use a custom remote connection with OAuth and automatic client registration in ChatGPT or Claude. Availability depends on the host's plan/workspace configuration. The product is not listed in either provider's app directory. Official setup references: [ChatGPT custom MCP](https://developers.openai.com/api/docs/guides/custom-mcp-server), [Claude custom connectors](https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp).

The official MCP SDK provides stateless Streamable HTTP with JSON responses. Only bearer access tokens issued by HomeBeacon are accepted; customer/operator cookies and device/admin keys are not MCP credentials. GET streams are unsupported (405); POST handles initialization, notifications, tool discovery and calls. Origin is restricted when present. Responses are not cached.

Five read-only tools:

- `homebeacon_get_build_guide`: setup steps, ingest schema and website registration link.
- `homebeacon_list_devices`: the connected customer's current conditions and freshness.
- `homebeacon_get_device_reports`: one owned link's customer-safe status and at most 30 allowlisted observations from the previous 30 days.

The result excludes household addresses, names, emails, operator notes, customer message bodies and all keys. IDs are customer link IDs. Tool inputs do not accept queries, collections, provider URLs or ingestion payloads. No tool can create/alter hazards, register hardware credentials, send messages, change help status or dispatch responders. The model's explanation is not used as a condition classification.

Two additional tools, `homebeacon_simulation_settings` and `homebeacon_run_simulation`, generate isolated fictional worlds without reading or changing customer records. See [SIMULATIONS.md](SIMULATIONS.md) for CLI, HTTP and local MCP use.

### Authorization

Discovery: `/.well-known/oauth-protected-resource/mcp` (root alias also supported), `/.well-known/oauth-authorization-server`. Authorization server routes: `/oauth/register`, `/oauth/authorize`, `/oauth/token`, `/oauth/revoke`.

Dynamic client registration supports `none`, `client_secret_post`, and `client_secret_basic`. Registered callbacks must be exact matches; HTTPS is required except loopback HTTP for local clients. No client URLs are fetched. Authorization codes require PKCE S256, expire after two minutes, and are consumed atomically. Pending browser approvals expire after ten minutes. The approval page names the app and return host and requires an explicit Allow action. The only scope is `homebeacon:read`.

Access tokens expire in one hour. Refresh tokens rotate and expire after 30 days. Replay revokes the grant. Tokens/codes/client secrets are stored hashed. Grants are resource-bound to the exact deployment's `/mcp` URL and checked against the current account on every call. Email/password changes invalidate old identity access. Customers can revoke connections immediately. Browser writes require the exact site Origin. Account/IP limits are atomically counted; expiry indexes clean up short-lived records.

The authorization implementation follows [MCP authorization](https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization) and the SDK's supported protocol versions. A full security audit and actual ChatGPT/Claude account connection remain distinct from SDK protocol testing.

## Optional NVIDIA key

`/api/customer/assistant`: GET returns configured status only, PUT saves a key after password verification, DELETE removes it, POST asks an explicit question. Keys are AES-256-GCM encrypted with a domain-separated key derived from `SESSION_SECRET` and the customer email as associated data. They never appear in GET responses, browser bundles or audits. Rotation of the server secret requires a key migration or re-entry.

Each question requires an explicit data-sharing choice. Only the question and selected customer-safe reports (or setup guide) are sent to the fixed NVIDIA HTTPS endpoint. Redirects are rejected; arbitrary provider hosts/models are not accepted. The model is `nvidia/nemotron-3-nano-30b-a3b`, documented in [NVIDIA's API reference](https://docs.api.nvidia.com/nim/reference/nvidia-nemotron-3-nano-30b-a3b-infer). Ten requests per account per hour, bounded input/output and a 30-second timeout limit usage. Provider errors are sanitized. Saving a key does not claim that it is valid; the first actual question checks it. No shared operator key is used as a fallback.

## Email changes

`PATCH /api/customer/account` requires current password plus the same new email twice. A transaction renames the account, preserves all device links and its box count, re-encrypts any NVIDIA key for the new identity, and revokes assistant grants. Old sessions stop working; a new cookie is returned. New accounts reusing the old email cannot inherit old signed cookies because session checks compare account creation time. Duplicate email conflicts roll back. No verification email or delivery provider is required; the new email is explicitly unverified.

## Storage and tests

New ordinary collections: `customer_assistant_settings`, `customer_build_requests`, `connect_limits`, `mcp_clients`, `mcp_pending`, `mcp_codes`, `mcp_tokens`, `mcp_grants`. No time-series schema changes. New short-lived collections have TTL indexes; long-lived registrations/grants/settings need account retention administration alongside existing customer records.

`test/customer-connect.test.js` covers registration, real ingest/replay in an isolated database, IDOR, CSRF, password checks, discovery/PKCE, code reuse, audience binding, an official MCP SDK client, token rotation/revocation, encryption/redaction, fixed-provider requests, and email migration/session invalidation. `docs/evaluations/customer-mcp.xml` defines stable read-only reasoning checks against those fixtures; it is an evaluation specification, not a claim of live model scores.

The local browser exercises real Pages OAuth/settings with a disposable MongoDB. Census timed out on the first browser attempt; subsequent registration used the real handler with a stubbed Census response. Live geocoding availability remains provider-dependent. The NVIDIA response path was verified with a provider stub; no customer NVIDIA key was available for live inference. See WORKLOG for final build/deployment evidence.
