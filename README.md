# Serverless Img2Img Style Transfer

Minimal production-minded img2img style-transfer stack for RunPod Serverless and RunPod Hub. It avoids ComfyUI, Automatic1111 and Forge, and uses a custom Diffusers/PyTorch worker.

## Architecture

- `frontend/` - Vite + React UI for upload, model/LoRA selection and generation results.
- `proxy/` - Express API proxy that keeps `RUNPOD_API_KEY` server-side.
- `worker/` - RunPod Serverless worker using `StableDiffusionXLImg2ImgPipeline`.

```
Browser -> frontend -> proxy /api/generate -> RunPod Serverless -> Diffusers worker
```

## RunPod Hub Repo

This repository is prepared as a RunPod Hub serverless repo.

- `.runpod/hub.json` defines Hub metadata and deploy-time environment inputs.
- `.runpod/tests.json` defines Hub validation tests.
- `.runpod/Dockerfile` is the Hub build entrypoint.
- `.runpod/handler.py` starts the serverless worker for Hub builds.

Hub releases are versioned from GitHub releases, not ordinary commits.

## Quick Start

```bash
npm install
cp proxy/.env.example proxy/.env
npm run dev
```

Open the Vite URL shown in the terminal. By default the frontend calls `http://localhost:8787`.

## Proxy Env

Set these in `proxy/.env` or your deployment environment:

```bash
RUNPOD_API_KEY=...
RUNPOD_ENDPOINT_ID=...
RUNPOD_API_BASE=https://api.runpod.ai/v2
RUNPOD_MODE=async
PORT=8787
```

`RUNPOD_MODE=sync` uses `/runsync`. `RUNPOD_MODE=async` uses `/run` plus polling `/status/{job_id}`.

## Worker Env

```bash
MODEL_CONFIG_PATH=/workspace/models/config/models.json
DEFAULT_GUIDANCE_SCALE=1.8
DEFAULT_SCHEDULER=dpmpp_2m_karras
OUTPUT_FORMAT=PNG
MAX_IMAGE_SIDE=1536
```

The included fallback config is at `worker/config/models.json`. On RunPod, mount/copy the config to `/workspace/models/config/models.json` or set `MODEL_CONFIG_PATH`.

`RUNPOD_TEST_MODE=true` is reserved for Hub validation. In that mode, the worker returns a small synthetic image without loading real checkpoints.

## RunPod Network Volume Layout

```text
/workspace/models/checkpoints/
  sdxl_base.safetensors
  custom_model_1.safetensors
  custom_model_2.safetensors
  custom_model_3.safetensors

/workspace/models/loras/
  lora_1.safetensors
  lora_2.safetensors
  lora_3.safetensors
  lora_4.safetensors
  lora_5.safetensors

/workspace/models/config/
  models.json
```

## Request Shape

```json
{
  "input": {
    "image_base64": "...",
    "model_id": "sdxl_base",
    "lora_id": "none",
    "denoise": 0.35,
    "lora_strength": 0.8,
    "quality": "balanced",
    "scale": 1.0,
    "num_images": 2
  }
}
```

No prompt, negative prompt, seed, CFG or sampler controls are exposed in the UI.

## Publish Flow

1. Push the repo to GitHub.
2. Create a GitHub release.
3. Submit the repository in RunPod Hub.
4. Wait for Hub build, test and review.
5. Deploy the published repo from Hub into a Serverless endpoint.
