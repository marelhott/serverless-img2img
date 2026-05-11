#!/usr/bin/env bash
set -euo pipefail

WORKSPACE_ROOT="${WORKSPACE_ROOT:-/workspace}"
MODELS_ROOT="${MODELS_ROOT:-$WORKSPACE_ROOT/models}"
CHECKPOINTS_DIR="${CHECKPOINTS_DIR:-$MODELS_ROOT/checkpoints}"
LORAS_DIR="${LORAS_DIR:-$MODELS_ROOT/loras}"
TMP_DIR="${TMP_DIR:-$WORKSPACE_ROOT/.downloads}"
PARALLEL="${PARALLEL:-4}"
INCLUDE_SDXL_BASE="${INCLUDE_SDXL_BASE:-0}"
HF_TOKEN="${HF_TOKEN:-}"

R2_MODELS_BASE="${R2_MODELS_BASE:-https://pub-4e46dcff44d744a1a90ab901a1cc9db5.r2.dev/checkpoints}"
R2_LORAS_BASE="${R2_LORAS_BASE:-https://pub-1694387d01ff49229be71d63751ffd94.r2.dev/loras}"

mkdir -p "$CHECKPOINTS_DIR" "$LORAS_DIR" "$TMP_DIR"

download_one() {
  local url="$1"
  local dest="$2"
  local label="$3"
  local tmp="$TMP_DIR/$(basename "$dest").part"

  echo "==> $label"
  echo "    $url"
  echo "    -> $dest"

  if [[ -f "$dest" && -s "$dest" ]]; then
    echo "    already exists, skipping"
    return 0
  fi

  mkdir -p "$(dirname "$dest")"

  if command -v aria2c >/dev/null 2>&1; then
    local -a args=(
      --console-log-level=warn
      --summary-interval=5
      --continue=true
      --max-connection-per-server="$PARALLEL"
      --split="$PARALLEL"
      --min-split-size=32M
      --file-allocation=none
      --dir="$(dirname "$tmp")"
      --out="$(basename "$tmp")"
    )
    if [[ -n "$HF_TOKEN" && "$url" == *huggingface.co* ]]; then
      args+=(--header="Authorization: Bearer $HF_TOKEN")
    fi
    aria2c "${args[@]}" "$url"
  else
    local -a curl_args=(-fL --retry 8 --retry-delay 3 -C - "$url" -o "$tmp")
    if [[ -n "$HF_TOKEN" && "$url" == *huggingface.co* ]]; then
      curl_args=(-fL --retry 8 --retry-delay 3 -C - -H "Authorization: Bearer $HF_TOKEN" "$url" -o "$tmp")
    fi
    curl "${curl_args[@]}"
  fi

  mv "$tmp" "$dest"
  echo "    done"
}

download_group() {
  local kind="$1"
  shift
  while [[ "$#" -gt 0 ]]; do
    local name="$1"
    local url="$2"
    local dest_dir="$3"
    download_one "$url" "$dest_dir/$name" "$kind $name"
    shift 3
  done
}

download_group "checkpoint" \
  "Tuymans_SDXL.safetensors" "$R2_MODELS_BASE/Tuymans_SDXL.safetensors" "$CHECKPOINTS_DIR" \
  "tuy_small.safetensors" "$R2_MODELS_BASE/tuy_small.safetensors" "$CHECKPOINTS_DIR"

download_group "lora" \
  "flux_tuymans_000001400.safetensors" "$R2_LORAS_BASE/flux_tuymans_000001400.safetensors" "$LORAS_DIR" \
  "lora_tuymans_SDXL.safetensors" "$R2_LORAS_BASE/lora_tuymans_SDXL.safetensors" "$LORAS_DIR" \
  "lora_tuymans_style.safetensors" "$R2_LORAS_BASE/lora_tuymans_style.safetensors" "$LORAS_DIR" \
  "lora_tuy_small.safetensors" "$R2_LORAS_BASE/lora_tuy_small.safetensors" "$LORAS_DIR"

if [[ "$INCLUDE_SDXL_BASE" == "1" ]]; then
  download_one \
    "https://huggingface.co/stabilityai/stable-diffusion-xl-base-1.0/resolve/main/sd_xl_base_1.0.safetensors?download=true" \
    "$CHECKPOINTS_DIR/sd_xl_base_1.0.safetensors" \
    "checkpoint sd_xl_base_1.0.safetensors"
fi

echo
echo "Fetch finished."
echo "Checkpoints: $CHECKPOINTS_DIR"
echo "LoRAs: $LORAS_DIR"
