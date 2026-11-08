# HomeBeacon Nemotron on Brev

This deployment bundle runs NVIDIA Nemotron Nano 9B v2 on a GPU VM. The files alone do not establish a live deployment. Check the work log for actual provisioning and test results.

## Verified November 7 deployment

- Instance `homebeacon-nemotron` / `fqjz30auo`, Crusoe L40S 48 GB, 128 GB disk; Brev account organization `aa3264-fd305f-9i38`.
- Model probe passed on the VM (3.0 seconds), through authenticated HTTPS (0.86 seconds), and through HomeBeacon's `npm run nvidia:check` adapter.
- `npm run system:demo -- --nvidia` completed all four tools and persisted/read back the review checkpoint in disposable local MongoDB. Sensor records were fictional; inference was real.
- The separate map-layer route passed a real model check: HTTP 200, `water` criterion, one correct fictional device. A discovered fenced-JSON trailing-whitespace case was fixed without weakening proposal validation.
- Fixed host shutdown timer: **2026-11-09 02:09 UTC / November 8, 8:09 PM Central**. Installed and active; its eventual execution and Brev stopped state still need verification. Crusoe documents guest shutdown as stopping on-demand compute; other providers may differ.
- Billing UI has no payment method connected and auto-recharge amount is $0. Compute is $1.74/hour; storage is $0.000132/GB-hour. At 128 GB, 24 hours is approximately **$42.17**, leaving about $17.83 of the initial $60 before other usage. Retained storage continues after stop.
- Preview deployment is configured through encrypted `NVIDIA_BREV_API_KEY` and non-secret GitHub variables. `NVIDIA_BREV_PREVIEW_BRANCH=pr-26` gates the preview configuration step. No production NVIDIA settings are changed by that job.

The authenticated demo endpoint is stored in the ignored local `.env` and the `NVIDIA_BREV_BASE_URL` repository variable. The inference token stays in private files and encrypted service stores. Never commit either `.env` or `.env.inference`.

The public model needs no NVIDIA Build or NGC API key. Brev login manages the GPU; the separately generated `VLLM_API_KEY` protects inference. HomeBeacon uses this inference token as `NVIDIA_API_KEY`.

## Launch on the GPU VM

Use one L40S with 48 GB VRAM and at least 100 GB disk. Store the deployment directory under `/home/ubuntu/workspace` so its cache and private configuration survive a Brev stop. Docker with the NVIDIA runtime, Python 3, curl, and Internet access must already work.

```sh
bash deploy/nemotron/launch.sh
python3 deploy/nemotron/probe.py
```

The first command creates a mode-600 `.env.inference` only when missing, downloads and checksum-verifies NVIDIA's parser, and starts the pinned vLLM container. Model download/loading can take several minutes. An existing container is left untouched; inspect its status before restarting or replacing it. `--prepare-only` prepares files without starting Docker.

The probe checks that an unauthenticated request is rejected, then requests one fictional structured tool call. It prints only the result, model identifier, and duration. HomeBeacon's own `npm run nvidia:check` must also pass after configuring the app endpoint.

The service binds only to `127.0.0.1:8000`. Run `python3 deploy/nemotron/gateway.py` on the GPU host to add the authenticated gateway at `127.0.0.1:8080`. It accepts only `GET /v1/models` and nonstreaming `POST /v1/chat/completions`, checks the same private token before reading a body, caps requests at 256 KiB and responses at 1 MiB, and uses a 45-second upstream timeout. Request/model bodies are not logged.

A separately configured HTTPS proxy/tunnel to **port 8080** that preserves bearer authentication is required for Cloudflare Pages to reach it. A Cloudflare Quick Tunnel is a temporary authenticated demo endpoint, not a stable production service; restarting it can change its hostname. Brev's browser-login tunnel is not a drop-in API endpoint. Never expose unauthenticated inference or put its token in browser JavaScript. The launcher does not start a tunnel or the gateway automatically.

`bash deploy/nemotron/start-demo-tunnel.sh` installs the authenticated gateway and pinned Cloudflare tunnel as Ubuntu systemd services. It verifies an unauthenticated 401 before opening the tunnel and preserves an already-running tunnel. If the VM is restarted, explicitly start the model container and verify the new tunnel URL; update the private app configuration and preview variable if it changed. The fixed shutdown deadline is not extended on restart.

Gateway verification without a GPU: `python3 -m unittest discover -s deploy/nemotron -p 'test_gateway.py'`.

Configure these **server-side** values in the intended preview/production environment:

```dotenv
NVIDIA_BASE_URL=https://YOUR_AUTHENTICATED_ENDPOINT/v1
NVIDIA_MODEL=nvidia/NVIDIA-Nemotron-Nano-9B-v2
NVIDIA_API_KEY=YOUR_PRIVATE_INFERENCE_TOKEN
```

HomeBeacon adds `/no_think` for this model. The parser requires nonstreaming requests; both app inference paths use `stream: false`. Validate the evidence/tool workflow and the separate map-layer JSON workflow before judging. Configuration is not proof of a successful real call.

## Cost and operational checks

The user's authorized budget is $60 of Brev credits. Recheck the actual price and current balance before creating/restarting an instance. The model launcher itself does **not** enforce a spending cap or stop the VM. `sudo env STOP_AT_UTC=<fixed-ISO-UTC-deadline> bash deploy/nemotron/install-stop-timer.sh` installs a persistent host shutdown timer, rejects containers and refuses to extend an existing deadline. The selected Crusoe VM has this timer installed as recorded above; it is a shutdown safeguard, not an absolute provider-enforced spending cap.

`docker stop homebeacon-nemotron` stops inference but does not stop GPU billing. Use `brev stop homebeacon-nemotron` from an authenticated CLI to request a provider stop, and verify stopped state. Storage may remain billable while stopped. A verified provider-side shutdown plan is required before leaving it unattended. Do not enable automatic credit recharge under this budget.

The pinned parser can log generated text on parse errors even with request logging disabled. Keep container logs private, use fictional records for integration checks, and never paste raw logs or `.env.inference` into chat or source control.

## Sources and pinned inputs

- [NVIDIA model and official vLLM instructions](https://huggingface.co/nvidia/NVIDIA-Nemotron-Nano-9B-v2): model revision `6533e8de2c68e4536bf7c411d7a3ce5734111476`; container `vllm/vllm-openai:v0.10.1`.
- [Pinned tool parser](https://huggingface.co/nvidia/NVIDIA-Nemotron-Nano-9B-v2/blob/6533e8de2c68e4536bf7c411d7a3ce5734111476/nemotron_toolcall_parser_no_streaming.py): SHA-256 `5dda26a379b7de9b98c628ff615c2c97803923541de46b226fb880d26a93fe9f`.
- [Brev instance lifecycle](https://docs.nvidia.com/brev/concepts/gpu-instances) and [CLI instance management](https://docs.nvidia.com/brev/cli/instance-management).

The 8,192-token context and concurrency limit of four are conservative demo settings, not a measured performance claim. NVIDIA requires `mamba_ssm_cache_dtype=float32` for this model.
