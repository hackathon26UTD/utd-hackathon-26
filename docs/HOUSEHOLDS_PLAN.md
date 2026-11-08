# Household sharing and alerts

Completed in PR #44 (`5977037`), production verified November 8. Email setup deferred by the user; delivery remains disabled. See `docs/verification/HOUSEHOLDS_2026-11-08.md`.

Request: share a home's status with other emails, let recipients choose email updates, and show nearby weather and local news. Existing owner permissions and unknown/stale semantics remain unchanged.

## Global constraints

- Work only in `/private/tmp/homebeacon-households-20261108`, branch `work/households`. Other workflows are active elsewhere.
- No real recipients, invites, synthetic homes or email tests in production. No credentials in output.
- Household sharing is read-only. Only the owner selects devices and manages invitations. Every read rechecks the owner account generation and active device links; every member is bound to an account generation and current email.
- Invitation possession allows acceptance by the addressed signed-in account; it does not verify the email for delivery. Email delivery requires a separate token delivered to that address and explicit opt-in. Copyable invitations work without an email provider and must say Not emailed.
- Missing/stale device data never means safe. Weather and news are separate context, never dispatch or device-risk inputs. Use actual Argus controls and concise copy.
- No new paid service or arbitrary external URL fetching. Sender is pending user input. Delivery remains disabled until configured.

### Task 1: Household accounts and customer UI

Own `src/households.js`, `functions/api/customer/households.js`, `ui/households.js`, `ui/households.css`, integration edits to `ui/customer.js`, household tests and `docs/HOUSEHOLDS.md`. Do not edit email or context modules, data scheduler, account email change code, or build scripts. Import CSS from UI module if supported by current build.

Implement household create/list/update/delete, explicit selected owned live link IDs (max 20), invitations addressed to email, accept/revoke/leave, and shared read-only customer snapshots. Owner max 5 households; max 20 members/invites per household. Invite expires 7 days, hashed random token, atomic one-use acceptance, rate limits and same-origin mutation checks. Never return token hashes or account credentials. No authorization by email alone. Re-created account/email changes invalidate membership by checking both email and sessionGeneration. Concurrent changes must not bypass bounds or resurrect removed memberships. Use transaction guards where needed. Existing owner APIs remain owner-only.

Schema contract: `households`: `_id` string, `ownerEmail`, `ownerGeneration`, `name`, `linkIds` string[], `active`, timestamps. `household_members`: `_id` string, `householdId`, `email`, `accountGeneration` (once accepted), `role` viewer|alerts, `status` pending|active|revoked, `inviteHash`, `inviteExpiresAt`, `preferences` {device:boolean,weather:boolean}, `emailVerifiedAt` nullable, `verifiedEmail` nullable. Owner has an active member row role owner. Preferences start false. Manual acceptance never sets emailVerifiedAt. Revoked members cannot receive email. Membership records are retained for audit.

Export `resolveHousehold(db,{email,householdId,requireOwner=false,requireView=true})` returning `{household,member,links}` or HttpError; `links` contains only still-owned selected live customer_links. It verifies account disabled/generation and owner binding each call. alerts-only members may call with requireView:false for preferences but cannot read device snapshots. Export `householdSnapshots(db,access,{env,now,deps}={})` returning only selected read-only customer device summaries, calling existing loadRisk/customerView/customerMessages and listCustomerDevices semantics, no keys/contact details/other devices. Export `ensureHouseholds(db)` for indexes. Export `activeHouseholdMember(db,memberId)` returning validated `{household,member,links}` or null for background delivery (all roles incl alerts), with current generation/email/owner/link checks.

UI contract: household section on /customer with create form, selected devices, invitation email and role, copy private link, pending status, revoke, accept via #household=TOKEN after login/signup, leave and shared snapshots refreshed about 10 seconds. Invitation raw token remains memory only, remove fragment immediately and never log it. Preserve claimed-device fragment flow. Argus tabs/dropdowns for choices, small rounded buttons, accessible keyboard/errors/focus, responsive no overflow. Email controls call `/api/customer/household-email` GET `?id=MEMBER_ID`, POST `{memberId,action:'verify'}`, POST `{memberId,action:'preferences',device,weather}`; show sender unavailable without saying sent. Verification fragment `#household-email=TOKEN` handled by parent-owned module later, not this task. Household context GET `/api/customer/household-context?id=HOUSEHOLD_ID`; render concise official alerts, forecast and news cards from schema documented below. Only fetch context for selected readable household, not every poll; refresh five minutes. UI can be implemented after backend contract settles, in same task if efficient.

Tests: real ephemeral replica MongoDB + signed sessions or pure database helpers; foreign IDs, alerts-only deny snapshots, owner unlink/reassign, account recreation/email change, invite expiry/reuse/revoke, membership revoke, preference separation, selected device isolation and stale semantics. No outgoing mail.

### Task 2: Local weather/news and email pipeline (controller)

Own new household-context and household-email source/route/test modules; scheduler integration; env examples and alert docs. Load NWS point-specific active alerts and forecast with bounded allowlisted fetch, original time, cache/stale disclosure. News uses configured trusted publisher RSS sources only, explicit regional scope and source links, no article body/reasoning into risk. Show missing setup honestly. Build provider adapter behind configuration, separate recipient verification, opt-in preferences, unsubscribe, durable dedupe/leases, bounded retry, current authority checks before delivery. Background sweep uses existing data refresh scheduler and no email side effects on normal GET. Never send unrequested real emails while testing. Email delivery cannot be called working until sender connected.

Context response: `{locations:[{label,weather:{status,checkedAt,alerts:[{id,title,severity,sent,expires,url}],forecast:[{startTime,summary,temperature,temperatureUnit,windSpeed,rainChance}],url},news:{status,source,scope,items:[{title,url,publishedAt}]}}],checkedAt}`. No exact address or coordinates in browser context response. Missing/failed source status explicit.

### Task 3: Review, integration and release

Review Task 1 against spec + quality, fix findings with implementer, then whole-branch security review of access, verification, revocation and delivery. Run appropriate new tests, full suite and build, headless desktop/mobile customer flows on disposable database. Update worklog/handoff/provider limits. Reconcile current origin/main, push and merge under existing authorization only after checks pass. Verify deployment; no simulated production households or actual email recipients.
