#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VOLUME_ID="${RUNPOD_VOLUME_ID:-pvhq2aariu}"
REGION="${RUNPOD_VOLUME_REGION:-EU-RO-1}"
ENDPOINT_URL="${RUNPOD_VOLUME_ENDPOINT_URL:-https://s3api-eu-ro-1.runpod.io}"

if [[ -z "${AWS_ACCESS_KEY_ID:-}" || -z "${AWS_SECRET_ACCESS_KEY:-}" ]]; then
  echo "AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY must be set." >&2
  exit 1
fi

echo "Seeding RunPod volume ${VOLUME_ID} in ${REGION}"

aws s3 cp \
  "${ROOT_DIR}/config/models.json" \
  "s3://${VOLUME_ID}/models/config/models.json" \
  --endpoint-url "${ENDPOINT_URL}" \
  --region "${REGION}"

printf 'keep\n' | aws s3 cp - "s3://${VOLUME_ID}/models/checkpoints/.keep" \
  --endpoint-url "${ENDPOINT_URL}" \
  --region "${REGION}"

printf 'keep\n' | aws s3 cp - "s3://${VOLUME_ID}/models/loras/.keep" \
  --endpoint-url "${ENDPOINT_URL}" \
  --region "${REGION}"

printf 'keep\n' | aws s3 cp - "s3://${VOLUME_ID}/outputs/.keep" \
  --endpoint-url "${ENDPOINT_URL}" \
  --region "${REGION}"

if [[ -n "${LOCAL_CHECKPOINT_DIR:-}" && -d "${LOCAL_CHECKPOINT_DIR}" ]]; then
  echo "Syncing checkpoints from ${LOCAL_CHECKPOINT_DIR}"
  aws s3 sync \
    "${LOCAL_CHECKPOINT_DIR}" \
    "s3://${VOLUME_ID}/models/checkpoints/" \
    --endpoint-url "${ENDPOINT_URL}" \
    --region "${REGION}" \
    --exclude ".DS_Store"
fi

if [[ -n "${LOCAL_LORA_DIR:-}" && -d "${LOCAL_LORA_DIR}" ]]; then
  echo "Syncing LoRAs from ${LOCAL_LORA_DIR}"
  aws s3 sync \
    "${LOCAL_LORA_DIR}" \
    "s3://${VOLUME_ID}/models/loras/" \
    --endpoint-url "${ENDPOINT_URL}" \
    --region "${REGION}" \
    --exclude ".DS_Store"
fi

echo "Done."
