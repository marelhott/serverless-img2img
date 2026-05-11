# RunPod Hub Serverless Img2Img

Focused SDXL img2img style-transfer worker for RunPod Serverless Hub.

## What it does

- accepts an input image as base64
- loads an SDXL checkpoint from a mounted volume
- optionally applies one LoRA
- runs img2img with fixed internal guidance and scheduler defaults
- returns generated images as base64

## Expected volume layout

```text
/workspace/models/checkpoints/
/workspace/models/loras/
/workspace/models/config/models.json
```

## Main input

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
    "num_images": 1
  }
}
```

## Notes

- prompt UI is intentionally omitted
- model and LoRA selection are config-driven
- `RUNPOD_TEST_MODE=true` is used only for Hub validation tests

