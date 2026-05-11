# RunPod Worker

This worker exposes a RunPod Serverless handler for SDXL img2img style transfer with optional LoRA.

## Build

```bash
docker build -t serverless-img2img-worker worker
```

Push the image to your registry and use it for the RunPod Serverless endpoint.

## Model Config

By default the worker reads:

```bash
MODEL_CONFIG_PATH=/workspace/models/config/models.json
```

If that file is absent, it falls back to the bundled `worker/config/models.json`.

## Notes

- Uses `StableDiffusionXLImg2ImgPipeline.from_single_file` for `.safetensors` checkpoints.
- Keeps the selected checkpoint loaded in global process memory.
- Changing only LoRA does not reload the checkpoint.
- Changing checkpoint unloads the previous pipeline and clears CUDA memory.
- Uses random seeds automatically and does not expose prompt, seed, CFG or sampler controls to the UI.

