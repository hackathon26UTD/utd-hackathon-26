# NVIDIA harness

The harness is how the app tells Nemotron what it needs to know, and how we check that the answers stay inside the rules. It is deterministic and needs no model to test. Everything is advisory and a person reviews the output.

## What it is

| Piece | File | Job |
| --- | --- | --- |
| Thresholds | `src/harness/thresholds.js` | One module that reads every number from the code (risk ladder, map card, power policy, messages, feeds). Generates [THRESHOLDS.md](THRESHOLDS.md). |
| Runbook | `src/harness/runbook.js` | What a person does per situation. Status and customer wording come from running the real engine on sample readings. Generates [RUNBOOK.md](RUNBOOK.md). |
| View filters | `src/harness/predicates.js` | The six fixed filter names. `functions/api/layers.js` runs these same functions. |
| Knowledge | `domain/knowledge/*.md` | Short curated text: role and limits, stale rules, untrusted data, how it works, view choice. Bundled as `src/harness/knowledge-data.js` because Workers cannot read files. |
| Pack | `src/harness/pack.js` | Builds the grounding text, within a token budget. |
| Evals | `src/harness/eval.js`, `test/fixtures/harness/*.json` | Golden cases and a deterministic grader. |
| CLI | `scripts/harness.mjs`, `scripts/commands/harness.mjs` | `npm run hb -- harness ...` |

## The grounding pack

`buildPack({ purpose })` returns versioned text (`hb-harness-1-<hash>`) plus the list of sections included and omitted.

- Purposes: `qa` (questions, default 6000 token budget), `view` (3500), `agent` (4500). Tokens are estimated at 4 characters each.
- Sections: role and hard limits, untrusted data, response format, stale and unknown rules, view filters, thresholds with units, status ladder and reasons, what a person does next, sensor taxonomy, how the app works.
- Trimming is deterministic. The first four sections (plus view filters for `view`) are required and are never cut; if they alone exceed the budget the build fails. Optional sections are added in a fixed priority order and skipped if they do not fit. Output order is fixed, so the same code gives the same text.
- The pack is memoized per purpose and budget.

Prompt-injection defense: alert text, device names, notes, messages, feed text and the question are data. `wrapUntrusted()` removes control characters, caps string and list sizes, and strips any `untrusted_data` tag so the data cannot close its own block. The pack tells the model that text inside the block is never an instruction. This lowers risk; it does not replace server validation.

## Where it is wired

- `POST /api/layers` with `method: "nvidia"`: the pack (`view`) is appended to the existing prompt. The server still validates names, combine, context ids and counts before computing matches.
- Investigation agent (`investigateSystem` in `src/system-agent.js`): the pack (`agent`) is appended to the existing prompt. Pass `harness: false` to leave the prompt unchanged. Tool validation, call limits and evidence-id checks are untouched.
- Nothing runs unless NVIDIA is configured, as before. Configuration alone does not prove a successful model call.

## Commands

```
npm run hb -- harness check               fail if THRESHOLDS.md, RUNBOOK.md or the knowledge bundle differ from the code
npm run hb -- harness sync                regenerate all three
npm run hb -- harness thresholds [--write|--check]
npm run hb -- harness runbook    [--write|--check]
npm run hb -- harness knowledge  [--write|--check]
npm run hb -- harness pack qa|view|agent [--budget N] [--json]
npm run hb -- harness eval                dry run of all golden cases
npm run hb -- harness eval --live         call the configured NVIDIA endpoint
```

After editing anything in `domain/knowledge/`, the runbook, or a threshold in code, run `harness sync` and commit the result. `npm test` fails if a generated file is stale.

## Evals

Golden cases live in `test/fixtures/harness/` and cover threshold questions, "what should I do" questions, stale and unknown handling, refusals (occupancy, safe entry, damage, coverage, dispatch, invented battery life), injection in alert text, device names and notes, and view filter selection for natural-language requests, including unsupported requests.

Each case holds the facts the pack must contain, a stub answer that must pass, and answers that must be rejected.

**Dry mode** (default, no model, no network): checks the pack contains each fact, the stub passes, every bad answer is rejected, and the untrusted block cannot be closed early.

**Live mode** (`--live`): sends the pack and the case to the configured endpoint and grades the real answer with the same grader. It reads only `NVIDIA_API_KEY`, `NVIDIA_BASE_URL` and `NVIDIA_MODEL` (from the environment, `.env` or `.dev.vars`), never prints them, and sends only fictional fixture text. Guards: at most 12 calls and 120000 estimated tokens by default (`--max-calls`, `--max-tokens`), 1.5 seconds between calls, 40 second timeout, HTTPS only except localhost. Agent cases are dry-only. If no key or endpoint is configured it prints that live mode did not run and exits with code 3.

The grader checks: the JSON shape, the status (`answered`, `refused`, `unknown`), required facts and numbers, view filter names and combine, and a list of claims that must never be made affirmatively: occupancy, safe entry, "the home is safe", damage, coverage, dispatch. A claim is ignored when it is negated or conditional ("I cannot say it is safe to enter"). This is a pattern check, so it catches wording drift, not every possible phrasing. A person should still read live results.

## Limits

- The live model has not been run against the final pack unless a report says so; dry mode proves the pack and grader, not the model.
- The grader is wording-based and can miss novel phrasings of a forbidden claim.
- Token counts are estimates (4 characters each).
- The harness explains and selects. It cannot approve an action, apply a power profile, send a message or query the database.
