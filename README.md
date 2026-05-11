# SDXL Img2Img Pod Runtime

Minimal img2img style-transfer app for RunPod pods.

No Forge, no Automatic1111, no ComfyUI.

## What it is

- `frontend/` - small React UI
- `app_runtime/` - FastAPI + Diffusers runtime
- `config/models.json` - model and LoRA registry
- `pod/` - RunPod pod image and start script

The app runs as one process on one port and serves both UI and API.

## Main flow

```text
Browser -> FastAPI pod runtime -> Diffusers pipeline -> images
```

## API

- `GET /health`
- `GET /api/options`
- `POST /api/generate`

Example payload:

```json
{
  "image_base64": "...",
  "model_id": "sdxl_base",
  "lora_id": "none",
  "denoise": 0.35,
  "lora_strength": 0.8,
  "quality": "balanced",
  "scale": 1.0,
  "num_images": 1
}
```

## Local demo

Install minimal deps:

```bash
python3 -m pip install -r app_runtime/requirements-demo.txt
npm install
npm run build:frontend
npm run start:local-demo
```

Then open:

```text
http://localhost:8000
```

`start:local-demo` uses `IMG2IMG_DEMO_MODE=true`, so you can test the full UI flow without mounted SDXL checkpoints.

## Local real runtime

When you have real models available locally or on a mounted volume:

```bash
python3 -m pip install -r app_runtime/requirements.txt
npm run build:frontend
MODEL_CONFIG_PATH=/absolute/path/to/models.json npm run start:local
```

## RunPod pod

Expected mounted volume layout:

```text
/workspace/models/checkpoints/
/workspace/models/loras/
/workspace/models/config/models.json
/workspace/outputs/
```

If you want to pre-populate the network volume without launching a Pod, use the S3-compatible API. This repo includes:

```bash
scripts/sync_runpod_volume.sh
```

Default target:

- volume id: `pvhq2aariu`
- region: `EU-RO-1`
- endpoint: `https://s3api-eu-ro-1.runpod.io`

It uploads:

- `config/models.json` -> `models/config/models.json`
- `.keep` placeholders for `models/checkpoints`, `models/loras`, `outputs`

Optional env vars for bulk sync:

```bash
AWS_ACCESS_KEY_ID=...
AWS_SECRET_ACCESS_KEY=...
LOCAL_CHECKPOINT_DIR=/absolute/path/to/checkpoints
LOCAL_LORA_DIR=/absolute/path/to/loras
bash scripts/sync_runpod_volume.sh
```

## Fastest asset transfer

If the models and LoRAs already live in public Cloudflare R2, the fastest path is not:

- local Mac -> upload to RunPod volume

The fastest path is:

- R2 -> temporary RunPod Pod in the same datacenter as the volume -> `/workspace/models/...`

Use:

```bash
bash scripts/fetch_r2_assets_to_workspace.sh
```

This downloads directly into the mounted network volume and keeps the files there permanently for future Pods.

Optional:

```bash
PARALLEL=8 bash scripts/fetch_r2_assets_to_workspace.sh
INCLUDE_SDXL_BASE=1 HF_TOKEN=hf_xxx bash scripts/fetch_r2_assets_to_workspace.sh
```

Build image from repo root:

```bash
docker build -f pod/Dockerfile -t sdxl-img2img-pod .
```

The pod container starts with:

```bash
/app/start.sh
```

That launches:

```bash
python3 -m uvicorn app_runtime.server:app --host 0.0.0.0 --port 8000
```

## Runtime env

```bash
HOST=0.0.0.0
PORT=8000
MODEL_CONFIG_PATH=/workspace/models/config/models.json
DEFAULT_GUIDANCE_SCALE=1.8
OUTPUT_FORMAT=PNG
MAX_IMAGE_SIDE=1536
ENABLE_CPU_OFFLOAD=false
```

## Notes

- model caching is in-process
- switching only LoRA is cheap compared to switching checkpoint
- switching checkpoint reloads the pipeline
- demo mode is only for local preview and fast validation
