import base64
import gc
import io
import json
import os
import random
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import runpod
from PIL import Image, ImageOps


QUALITY_TO_STEPS = {
    "fast": 15,
    "balanced": 25,
    "high": 35,
    "maximum": 50,
}

ALLOWED_SCALES = {1.0, 1.25, 1.5, 2.0}
DEFAULT_CONFIG_PATH = Path(__file__).parent / "config" / "models.json"

CURRENT_MODEL_ID = None
CURRENT_PIPELINE = None
CURRENT_LORA_ID = "none"
CURRENT_LORA_STRENGTH = 0.0
MODEL_CONFIG = None
TORCH_MODULE = None
DIFFUSERS_MODULES = None


@dataclass(frozen=True)
class GenerationInput:
    image_base64: str
    model_id: str
    lora_id: str
    denoise: float
    lora_strength: float
    quality: str
    scale: float
    num_images: int


def handler(event: dict[str, Any]) -> dict[str, Any]:
    try:
        generation_input = parse_input(event.get("input") or {})

        if use_test_mode():
            return build_test_response(generation_input)

        torch = get_torch()
        pipe = ensure_pipeline(generation_input.model_id)
        ensure_lora(pipe, generation_input.lora_id, generation_input.lora_strength)

        source_image = decode_image(generation_input.image_base64)
        source_image = normalize_dimensions(source_image)

        steps = QUALITY_TO_STEPS[generation_input.quality]
        guidance_scale = float(os.getenv("DEFAULT_GUIDANCE_SCALE", "1.8"))
        output_images = []

        for _ in range(generation_input.num_images):
            seed = random.randint(0, 2**31 - 1)
            generator = torch.Generator(device="cuda").manual_seed(seed)
            result = pipe(
                prompt="",
                image=source_image,
                strength=generation_input.denoise,
                guidance_scale=guidance_scale,
                num_inference_steps=steps,
                generator=generator,
            ).images[0]

            result = upscale_if_needed(result, generation_input.scale)
            output_images.append(encode_image(result))

        return {
            "images": output_images,
            "meta": {
                "model_id": generation_input.model_id,
                "lora_id": generation_input.lora_id,
                "denoise": generation_input.denoise,
                "lora_strength": generation_input.lora_strength,
                "steps": steps,
                "scale": generation_input.scale,
                "guidance_scale": guidance_scale,
            },
        }
    except Exception as exc:
        if is_cuda_oom(exc):
            clear_cuda()
            return {"error": f"CUDA out of memory: {exc}"}
        return {"error": str(exc)}


def get_torch():
    global TORCH_MODULE
    if TORCH_MODULE is None:
        import torch

        TORCH_MODULE = torch
    return TORCH_MODULE


def get_diffusers():
    global DIFFUSERS_MODULES
    if DIFFUSERS_MODULES is None:
        from diffusers import DPMSolverMultistepScheduler, StableDiffusionXLImg2ImgPipeline

        DIFFUSERS_MODULES = {
            "scheduler": DPMSolverMultistepScheduler,
            "pipeline": StableDiffusionXLImg2ImgPipeline,
        }
    return DIFFUSERS_MODULES


def is_cuda_oom(exc: Exception) -> bool:
    return exc.__class__.__name__ == "OutOfMemoryError" and exc.__class__.__module__.startswith("torch")


def parse_input(payload: dict[str, Any]) -> GenerationInput:
    if not payload.get("image_base64"):
        raise ValueError("image_base64 is required.")

    quality = str(payload.get("quality", "balanced")).lower()
    if quality not in QUALITY_TO_STEPS:
        quality = "balanced"

    scale = float(payload.get("scale", 1.0))
    if scale not in ALLOWED_SCALES:
        scale = 1.0

    return GenerationInput(
        image_base64=str(payload["image_base64"]),
        model_id=str(payload.get("model_id", "sdxl_base")),
        lora_id=str(payload.get("lora_id", "none")),
        denoise=clamp(float(payload.get("denoise", 0.35)), 0.05, 1.0),
        lora_strength=clamp(float(payload.get("lora_strength", 0.8)), 0.0, 2.0),
        quality=quality,
        scale=scale,
        num_images=int(clamp(int(payload.get("num_images", 1)), 1, 4)),
    )


def ensure_pipeline(model_id: str):
    global CURRENT_MODEL_ID, CURRENT_PIPELINE, CURRENT_LORA_ID, CURRENT_LORA_STRENGTH

    if CURRENT_PIPELINE is not None and CURRENT_MODEL_ID == model_id:
        return CURRENT_PIPELINE

    model = get_config_item("models", model_id)
    model_path = model.get("path")
    if not model_path or not Path(model_path).exists():
        raise FileNotFoundError(f"Model checkpoint not found for '{model_id}': {model_path}")

    if CURRENT_PIPELINE is not None:
        del CURRENT_PIPELINE
        CURRENT_PIPELINE = None
        clear_cuda()

    torch = get_torch()
    diffusers = get_diffusers()
    pipe = diffusers["pipeline"].from_single_file(
        model_path,
        torch_dtype=torch.float16,
        use_safetensors=True,
    )
    pipe.scheduler = make_scheduler(pipe.scheduler.config)
    pipe = pipe.to("cuda")

    try:
        pipe.enable_xformers_memory_efficient_attention()
    except Exception:
        pass

    if os.getenv("ENABLE_CPU_OFFLOAD", "false").lower() == "true":
        pipe.enable_model_cpu_offload()

    CURRENT_MODEL_ID = model_id
    CURRENT_PIPELINE = pipe
    CURRENT_LORA_ID = "none"
    CURRENT_LORA_STRENGTH = 0.0
    return pipe


def ensure_lora(pipe, lora_id: str, lora_strength: float) -> None:
    global CURRENT_LORA_ID, CURRENT_LORA_STRENGTH

    if lora_id == "none":
        if CURRENT_LORA_ID != "none":
            pipe.unload_lora_weights()
            CURRENT_LORA_ID = "none"
            CURRENT_LORA_STRENGTH = 0.0
        return

    lora = get_config_item("loras", lora_id)
    lora_path = lora.get("path")
    if not lora_path or not Path(lora_path).exists():
        raise FileNotFoundError(f"LoRA not found for '{lora_id}': {lora_path}")

    if CURRENT_LORA_ID != lora_id:
        if CURRENT_LORA_ID != "none":
            pipe.unload_lora_weights()
        pipe.load_lora_weights(lora_path, adapter_name="default")
        CURRENT_LORA_ID = lora_id

    if CURRENT_LORA_STRENGTH != lora_strength:
        pipe.set_adapters(["default"], adapter_weights=[lora_strength])
        CURRENT_LORA_STRENGTH = lora_strength


def make_scheduler(config: Any):
    diffusers = get_diffusers()
    return diffusers["scheduler"].from_config(
        config,
        algorithm_type="sde-dpmsolver++",
        use_karras_sigmas=True,
    )


def decode_image(image_base64: str) -> Image.Image:
    if "," in image_base64:
        image_base64 = image_base64.split(",", 1)[1]
    raw = base64.b64decode(image_base64)
    image = Image.open(io.BytesIO(raw))
    image = ImageOps.exif_transpose(image)
    return image.convert("RGB")


def normalize_dimensions(image: Image.Image) -> Image.Image:
    max_side = int(os.getenv("MAX_IMAGE_SIDE", "1536"))
    width, height = image.size

    if max(width, height) > max_side:
        ratio = max_side / max(width, height)
        width = int(width * ratio)
        height = int(height * ratio)

    width = max(64, (width // 8) * 8)
    height = max(64, (height // 8) * 8)
    return image.resize((width, height), Image.Resampling.LANCZOS)


def upscale_if_needed(image: Image.Image, scale: float) -> Image.Image:
    if scale == 1.0:
        return image
    width, height = image.size
    return image.resize((round(width * scale), round(height * scale)), Image.Resampling.LANCZOS)


def encode_image(image: Image.Image) -> dict[str, Any]:
    output_format = os.getenv("OUTPUT_FORMAT", "PNG").upper()
    if output_format not in {"PNG", "WEBP"}:
        output_format = "PNG"

    buffer = io.BytesIO()
    save_kwargs = {"format": output_format}
    if output_format == "WEBP":
        save_kwargs.update({"quality": 95, "method": 6})
    image.save(buffer, **save_kwargs)

    return {
        "image_base64": base64.b64encode(buffer.getvalue()).decode("utf-8"),
        "width": image.width,
        "height": image.height,
        "format": output_format.lower(),
    }


def use_test_mode() -> bool:
    return os.getenv("RUNPOD_TEST_MODE", "false").lower() == "true"


def build_test_response(generation_input: GenerationInput) -> dict[str, Any]:
    width = 512 if generation_input.scale == 1.0 else round(512 * generation_input.scale)
    height = 512 if generation_input.scale == 1.0 else round(512 * generation_input.scale)
    image = Image.new("RGB", (width, height), color=(242, 244, 247))

    return {
        "images": [encode_image(image)],
        "meta": {
            "model_id": generation_input.model_id,
            "lora_id": generation_input.lora_id,
            "denoise": generation_input.denoise,
            "lora_strength": generation_input.lora_strength,
            "steps": QUALITY_TO_STEPS[generation_input.quality],
            "scale": generation_input.scale,
            "guidance_scale": float(os.getenv("DEFAULT_GUIDANCE_SCALE", "1.8")),
            "test_mode": True,
        },
    }


def get_config_item(section: str, item_id: str) -> dict[str, Any]:
    config = load_config()
    for item in config.get(section, []):
        if item.get("id") == item_id:
            return item
    raise ValueError(f"Unknown {section[:-1]} id: {item_id}")


def load_config() -> dict[str, Any]:
    global MODEL_CONFIG
    if MODEL_CONFIG is not None:
        return MODEL_CONFIG

    configured_path = Path(os.getenv("MODEL_CONFIG_PATH", ""))
    config_path = configured_path if configured_path.exists() else DEFAULT_CONFIG_PATH
    with config_path.open("r", encoding="utf-8") as config_file:
        MODEL_CONFIG = json.load(config_file)
    return MODEL_CONFIG


def clear_cuda() -> None:
    torch = get_torch()
    gc.collect()
    if torch.cuda.is_available():
        torch.cuda.empty_cache()
        torch.cuda.ipc_collect()


def clamp(value: float, minimum: float, maximum: float) -> float:
    return min(max(value, minimum), maximum)


if __name__ == "__main__":
    runpod.serverless.start({"handler": handler})
