#!/usr/bin/env bash
# Run on the Brev GPU VM inside /home/ubuntu/workspace, not on a laptop.
set -euo pipefail
umask 077
cd -- "$(dirname -- "$0")"

readonly model='nvidia/NVIDIA-Nemotron-Nano-9B-v2'
readonly revision='6533e8de2c68e4536bf7c411d7a3ce5734111476'
readonly parser_sha='5dda26a379b7de9b98c628ff615c2c97803923541de46b226fb880d26a93fe9f'
readonly image='vllm/vllm-openai:v0.10.1'
readonly container='homebeacon-nemotron'

if [[ $# -gt 1 || (${1:-} != '' && ${1:-} != '--prepare-only') ]]; then
  printf 'Usage: bash launch.sh [--prepare-only]\n' >&2
  exit 2
fi
for dependency in curl python3; do
  command -v "$dependency" >/dev/null || { printf 'Missing dependency: %s\n' "$dependency" >&2; exit 1; }
done
if [[ ${1:-} != '--prepare-only' ]]; then
  command -v docker >/dev/null || { printf 'Docker is required.\n' >&2; exit 1; }
  docker info >/dev/null
  if docker container inspect "$container" >/dev/null 2>&1; then
    printf 'Container already exists. Inspect its status before changing or restarting it.\n' >&2
    exit 1
  fi
fi

mkdir -p cache vendor
chmod 700 cache vendor
python3 - <<'PY'
import os
import re
import secrets
from pathlib import Path
p = Path('.env.inference')
if not p.exists():
    fd = os.open(p, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, 'w') as f:
        f.write('VLLM_API_KEY=' + secrets.token_hex(32) + '\n')
if p.is_symlink():
    raise SystemExit('Refusing a symlink for the inference secret file.')
p.chmod(0o600)
if not re.fullmatch(r'VLLM_API_KEY=[A-Za-z0-9_-]{32,}\n?', p.read_text()):
    raise SystemExit('Invalid inference secret file. Expected one VLLM_API_KEY entry of at least 32 URL-safe characters.')
PY

parser='vendor/nemotron_toolcall_parser_no_streaming.py'
download="$(mktemp vendor/parser.XXXXXXXX)"
trap 'rm -f -- "$download"' EXIT
curl --fail --silent --show-error --location \
  --proto '=https' --proto-redir '=https' \
  "https://huggingface.co/$model/resolve/$revision/nemotron_toolcall_parser_no_streaming.py" \
  --output "$download"
python3 - "$download" "$parser_sha" <<'PY'
import hashlib
import sys
from pathlib import Path
if hashlib.sha256(Path(sys.argv[1]).read_bytes()).hexdigest() != sys.argv[2]:
    raise SystemExit('NVIDIA parser checksum did not match; nothing was launched.')
PY
mv -- "$download" "$parser"
if [[ ${1:-} == '--prepare-only' ]]; then
  printf 'Prepared private configuration and verified NVIDIA parser. No container started.\n'
  exit 0
fi

docker run -d --name "$container" \
  --gpus all --ipc=host \
  --publish 127.0.0.1:8000:8000 \
  --env-file .env.inference \
  --volume "$PWD/cache:/root/.cache/huggingface" \
  --volume "$PWD/$parser:/opt/nemotron_parser.py:ro" \
  --log-opt max-size=10m --log-opt max-file=2 \
  "$image" \
  --model "$model" --revision "$revision" \
  --trust-remote-code --tensor-parallel-size 1 \
  --max-model-len 8192 --max-num-seqs 4 \
  --mamba_ssm_cache_dtype float32 \
  --enable-auto-tool-choice \
  --tool-parser-plugin /opt/nemotron_parser.py \
  --tool-call-parser nemotron_json \
  --disable-log-requests >/dev/null
printf 'Container started on localhost:8000. Model loading is asynchronous. Run python3 probe.py to verify readiness and a real tool call.\n'
