#!/usr/bin/env bash
set -euo pipefail

if [[ -z "${RUNPOD_API_KEY:-}" ]]; then
  echo "Set RUNPOD_API_KEY first." >&2
  exit 1
fi

POD_NAME="${POD_NAME:-img2img-simple-runtime}"
TEMPLATE_ID="${TEMPLATE_ID:-}"
NETWORK_VOLUME_ID="${NETWORK_VOLUME_ID:-pvhq2aariu}"
GPU_TYPE="${GPU_TYPE:-NVIDIA GeForce RTX 4090}"
GPU_COUNT="${GPU_COUNT:-1}"
DATACENTER_ID="${DATACENTER_ID:-EU-RO-1}"
CONTAINER_DISK_GB="${CONTAINER_DISK_GB:-40}"
VOLUME_MOUNT_PATH="${VOLUME_MOUNT_PATH:-/workspace}"
POD_PORTS="${POD_PORTS:-8000/http,22/tcp}"
CLOUD_TYPE="${CLOUD_TYPE:-SECURE}"

if [[ -z "$TEMPLATE_ID" ]]; then
  echo "Set TEMPLATE_ID." >&2
  exit 1
fi

IFS=',' read -r -a PORT_ITEMS <<< "$POD_PORTS"
PORTS_JSON=""
for port in "${PORT_ITEMS[@]}"; do
  port="$(printf '%s' "$port" | xargs)"
  [[ -z "$port" ]] && continue
  if [[ -n "$PORTS_JSON" ]]; then
    PORTS_JSON+=", "
  fi
  PORTS_JSON+="\"$port\""
done

PAYLOAD_FILE="$(mktemp "${TMPDIR:-/tmp}/runpod-pod.XXXXXX.json")"
trap 'rm -f "$PAYLOAD_FILE"' EXIT

cat > "$PAYLOAD_FILE" <<EOF
{
  "name": "$POD_NAME",
  "cloudType": "$CLOUD_TYPE",
  "computeType": "GPU",
  "gpuCount": $GPU_COUNT,
  "gpuTypeIds": [
    "$GPU_TYPE"
  ],
  "dataCenterIds": [
    "$DATACENTER_ID"
  ],
  "containerDiskInGb": $CONTAINER_DISK_GB,
  "ports": [
    $PORTS_JSON
  ],
  "networkVolumeId": "$NETWORK_VOLUME_ID",
  "volumeMountPath": "$VOLUME_MOUNT_PATH",
  "templateId": "$TEMPLATE_ID",
  "interruptible": false,
  "supportPublicIp": true
}
EOF

curl --request POST \
  --url https://rest.runpod.io/v1/pods \
  --header "Authorization: Bearer ${RUNPOD_API_KEY}" \
  --header 'Content-Type: application/json' \
  --data @"$PAYLOAD_FILE"
