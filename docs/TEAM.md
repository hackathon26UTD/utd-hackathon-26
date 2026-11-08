# Safe Home team and contribution guide

Current as of November 8, 2026. The private project repository belongs to **hackathon26UTD**. This document records observed contributions, not exclusive ownership, current account permissions or unverified assignments.

| Teammate | Observed contribution |
| --- | --- |
| Ayan Basheer | Assisted product direction, Argus-based design, account/customer experience, command workspace, infrastructure integration and release verification |
| Dhruv | Core API, hardware clients/firmware, shared credential tooling, hardware/weather research and per-sensor duration thresholds |
| Adyaan | Organization and shared database foundation |
| Saif | Team collaborator; check current branch/task before assigning or duplicating work |

The additive telemetry/latched-incident extension entered through PR #14 as a separate database workstream. Preserve its contract alongside the core hardware API. Credit actual contributions in PRs and docs; do not describe a whole shared subsystem as sole-authored by the latest editor.

## Coordinate through current repository evidence

Before editing, inspect local status, fetch origin and read relevant open PRs/branches. If two tasks touch the same files, isolate work and reconcile both intended behaviors. Do not merge the unrelated FutureYou application into Safe Home without explicit direction.

A useful handoff includes the problem, changed behavior, touched contract, branch/commit, checks actually run, runtime evidence and remaining work. Put long details in the relevant subsystem doc and link them from the PR. Keep credentials, private invitation links and real addresses out of review examples.

## Team records

### November 8 history update

The GitHub branch histories were rewritten on November 8 to remove development-tool co-author trailers, branch-name prefixes, commit-description mentions and handoff provenance. Human authors, timestamps, merge relationships, application code, configuration and required license files were preserved; historical handoff prose was normalized. Sixteen branches were renamed under `work/`. Historical commit IDs changed; signatures attached to rewritten commits cannot remain valid. Old PR records may retain earlier commit copies.

If your clone predates this update, save any uncommitted work and use a fresh clone before pushing. Bring over only your new work. Do not merge an old local branch into the rewritten history, which would reintroduce the removed trailers. The owner retained a local pre-rewrite bundle and old-to-new commit map for recovery; these are not published to GitHub.

Commit attribution should credit people accurately. Local development-tool settings disable automatic commit and PR bylines. Product integration and third-party license documentation remains intact.

[Architecture](ARCHITECTURE.md) describes shared boundaries. [Development](DEVELOPMENT.md) covers local work and checks. [Operations](OPERATIONS_RUNBOOK.md) covers release responsibility. [WORKLOG.md](WORKLOG.md) is the chronological evidence trail; [CHANGELOG.md](../CHANGELOG.md) is the short release history.

Private contacts remain in the existing private contact document. Do not copy them into public pages or send messages simply because an address is available. Recheck current GitHub/Atlas roles before access changes; old invitation/membership observations are not proof of current status.
