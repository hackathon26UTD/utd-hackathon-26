# Operator views and NVIDIA connection

The command center supports read-only observation layers for water, power interruption, Internet interruption, missing recent reports, low battery and critical observations. Operators preview matches, inspect source timestamps, apply a layer to the property list and map, then clear it. Underlying readings and recorded priority are never changed by the model.

## Demo operator

Sign in at `/login` with `demo@homebeacon.local` and `HomeBeaconDemo2026!`. These credentials are intentionally public. The account is restricted to exercise records and preset layer views. It cannot read live device data, enroll devices, change accounts, write follow-ups, export live records or spend NVIDIA quota. Its profile is read-only. `/demo` also supports exercise views without sign-in.

## NVIDIA

The adapter is ready but no NVIDIA key or model endpoint is connected yet. Set encrypted Cloudflare `NVIDIA_API_KEY`, optionally `NVIDIA_MODEL`. Default model is `nvidia/llama-3.3-nemotron-super-49b-v1.5`. A team-hosted NIM-compatible model can use `NVIDIA_BASE_URL` instead. Treat the configured endpoint as an administrator-trusted destination. The hosted endpoint is https://integrate.api.nvidia.com/v1/chat/completions.

`GET /api/layers` reports configuration state. `POST /api/layers` takes `method` (`preset` or `nvidia`), `filter` for presets, and `question` (maximum 1,000 characters). Requires a signed operator session and same-origin request. Hosted model calls are capped at four per minute per operator and time out after 40 seconds.

NVIDIA receives a bounded snapshot of the latest sensor values and timestamps for up to 500 boxes. It does not receive operator emails, addresses, household names, credentials or free-text notes. This is not the entire MongoDB history. The response must choose a supported observation filter. The server calculates matching IDs directly from recorded values and returns source evidence. Model text is an interpretation, not a verified assessment. No damage probabilities, occupancy inference, claims decisions or automatic dispatch.

## Extension path

Add vetted sensor predicates and aggregate windows before expanding model-generated views. Historical analysis should use bounded, indexed Mongo queries with explicit coverage periods. Never let a model run arbitrary MongoDB commands or arbitrary browser code. A model unavailable state must preserve ordinary observation filtering.

Official API reference: https://docs.api.nvidia.com/nim/reference/nvidia-llama-3_3-nemotron-super-49b-v1_5-infer

## Operational update

Adding encrypted account settings exposed a missing production database binding. Restored all required secrets explicitly in both environments. Deployment health checks caught the issue before reporting the site ready.
