#!/usr/bin/env bash
set -euo pipefail

if [[ -z "${RUNPOD_API_KEY:-}" ]]; then
  echo "Set RUNPOD_API_KEY first." >&2
  exit 1
fi

TEMPLATE_NAME="${TEMPLATE_NAME:-img2img-simple-runtime}"
IMAGE_NAME="${IMAGE_NAME:-ghcr.io/marelhott/serverless-img2img:pod-latest}"
TEMPLATE_CATEGORY="${TEMPLATE_CATEGORY:-NVIDIA}"
CONTAINER_DISK_GB="${CONTAINER_DISK_GB:-40}"
VOLUME_MOUNT_PATH="${VOLUME_MOUNT_PATH:-/workspace}"
TEMPLATE_PORTS="${TEMPLATE_PORTS:-8000/http,22/tcp}"
IS_PUBLIC="${IS_PUBLIC:-false}"
WORKSPACE_ROOT="${WORKSPACE_ROOT:-/workspace}"
MODEL_CONFIG_PATH="${MODEL_CONFIG_PATH:-/workspace/models/config/models.json}"

IFS=',' read -r -a PORT_ITEMS <<< "$TEMPLATE_PORTS"
PORTS_JSON=""
for port in "${PORT_ITEMS[@]}"; do
  port="$(printf '%s' "$port" | xargs)"
  [[ -z "$port" ]] && continue
  if [[ -n "$PORTS_JSON" ]]; then
    PORTS_JSON+=", "
  fi
  PORTS_JSON+="\"$port\""
done

README_TEXT="$(cat <<EOF
# Img2Img Simple Runtime

Minimal SDXL img2img runtime for RunPod pods.

Ports:
- 8000/http: web app + API
- 22/tcp: optional SSH

Expected volume layout:
- $WORKSPACE_ROOT/models/checkpoints
- $WORKSPACE_ROOT/models/loras
- $MODEL_CONFIG_PATH
EOF
)"

PAYLOAD_FILE="$(mktemp "${TMPDIR:-/tmp}/runpod-template.XXXXXX.json")"
trap 'rm -f "$PAYLOAD_FILE"' EXIT

cat > "$PAYLOAD_FILE" <<EOF
{
  "name": "$TEMPLATE_NAME",
  "imageName": "$IMAGE_NAME",
  "category": "$TEMPLATE_CATEGORY",
  "containerDiskInGb": $CONTAINER_DISK_GB,
  "dockerEntrypoint": [
    "/bin/bash"
  ],
  "dockerStartCmd": [
    "-lc",
    "exec /bin/bash /app/start.sh"
  ],
  "env": {
    "HOST": "0.0.0.0",
    "PORT": "8000",
    "MODEL_CONFIG_PATH": "$MODEL_CONFIG_PATH",
    "DEFAULT_GUIDANCE_SCALE": "1.8",
    "OUTPUT_FORMAT": "PNG",
    "MAX_IMAGE_SIDE": "1536",
    "ENABLE_CPU_OFFLOAD": "false"
  },
  "isPublic": $IS_PUBLIC,
  "isServerless": false,
  "ports": [
    $PORTS_JSON
  ],
  "readme": $(printf '%s' "$README_TEXT" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()))'),
  "volumeInGb": 0,
  "volumeMountPath": "$VOLUME_MOUNT_PATH"
}
EOF

curl --request POST \
  --url https://rest.runpod.io/v1/templates \
  --header "Authorization: Bearer ${RUNPOD_API_KEY}" \
  --header 'Content-Type: application/json' \
  --data @"$PAYLOAD_FILE"
