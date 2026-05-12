#!/usr/bin/env bash
set -euo pipefail

VOLUME_ID="${RUNPOD_VOLUME_ID:-pvhq2aariu}"
REGION="${RUNPOD_VOLUME_REGION:-EU-RO-1}"
ENDPOINT_URL="${RUNPOD_VOLUME_ENDPOINT_URL:-https://s3api-eu-ro-1.runpod.io}"

R2_MODELS_BASE="${R2_MODELS_BASE:-https://pub-4e46dcff44d744a1a90ab901a1cc9db5.r2.dev/checkpoints}"
R2_LORAS_BASE="${R2_LORAS_BASE:-https://pub-1694387d01ff49229be71d63751ffd94.r2.dev/loras}"

if [[ -z "${AWS_ACCESS_KEY_ID:-}" || -z "${AWS_SECRET_ACCESS_KEY:-}" ]]; then
  echo "AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY must be set." >&2
  exit 1
fi

copy_if_missing() {
  local source_url="$1"
  local target_key="$2"

  if aws s3 ls "s3://${VOLUME_ID}/${target_key}" --endpoint-url "${ENDPOINT_URL}" --region "${REGION}" >/dev/null 2>&1; then
    echo "skip ${target_key}"
    return 0
  fi

  echo "stream ${source_url} -> s3://${VOLUME_ID}/${target_key}"
  curl -fL --retry 8 --retry-delay 3 "${source_url}" | aws s3 cp - "s3://${VOLUME_ID}/${target_key}" \
    --endpoint-url "${ENDPOINT_URL}" \
    --region "${REGION}"
}

copy_if_missing \
  "${R2_MODELS_BASE}/hofmann_SDXL.safetensors" \
  "models/checkpoints/hofmann_SDXL.safetensors"

copy_if_missing \
  "${R2_LORAS_BASE}/lora_hofmann_SDXL.safetensors" \
  "models/loras/lora_hofmann_SDXL.safetensors"

aws s3 cp \
  "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/config/models.json" \
  "s3://${VOLUME_ID}/models/config/models.json" \
  --endpoint-url "${ENDPOINT_URL}" \
  --region "${REGION}"

echo "done"
