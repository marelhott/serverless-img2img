#!/usr/bin/env bash
set -euo pipefail

export HOST="${HOST:-0.0.0.0}"
export PORT="${PORT:-8000}"
export MODEL_CONFIG_PATH="${MODEL_CONFIG_PATH:-/workspace/models/config/models.json}"
export DEFAULT_GUIDANCE_SCALE="${DEFAULT_GUIDANCE_SCALE:-1.8}"
export OUTPUT_FORMAT="${OUTPUT_FORMAT:-PNG}"
export MAX_IMAGE_SIDE="${MAX_IMAGE_SIDE:-1536}"
export ENABLE_CPU_OFFLOAD="${ENABLE_CPU_OFFLOAD:-false}"

exec python3 -m uvicorn app_runtime.server:app --host "${HOST}" --port "${PORT}"

