# 0001. Name the product Safe Home

- Status: Accepted
- Date: November 8, 2026
- Decider: Ayan Basheer

## Context

The existing HackUTD product and website were named HomeBeacon. Ayan requested the entire site be called Safe Home and asked for substantially improved documentation committed to the organization repository.

## Decision

Use Safe Home across first-party product presentation and current team entry-point documentation. Preserve compatibility-sensitive identifiers and infrastructure resources. Publish the living guides in the existing private `hackathon26UTD/utd-hackathon-26` repository.

## Consequences

People see the new name while existing sessions, device keys, URLs, pairings and assistant connections remain compatible. Historical records and some technical names still say HomeBeacon; [BRAND.md](../BRAND.md) explains why. No database migration, credential rotation, repository move, domain purchase or new safety claim is part of this rename.

## Alternatives

A full technical-identifier rename would require session, client and stored-data migration without improving the requested presentation. It is deferred unless separately needed. Creating a public organization profile with internal documentation would expose private project context, so documentation remains in the authorized private repository.
