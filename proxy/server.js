import cors from "cors";
import dotenv from "dotenv";
import express from "express";

dotenv.config();

const app = express();
const port = Number(process.env.PORT || 8787);
const apiBase = process.env.RUNPOD_API_BASE || "https://api.runpod.ai/v2";
const endpointId = process.env.RUNPOD_ENDPOINT_ID;
const apiKey = process.env.RUNPOD_API_KEY;
const runpodMode = process.env.RUNPOD_MODE || "async";
const pollIntervalMs = Number(process.env.RUNPOD_POLL_INTERVAL_MS || 1500);
const pollTimeoutMs = Number(process.env.RUNPOD_POLL_TIMEOUT_MS || 300000);

const MODELS = [
  { id: "sdxl_base", name: "SDXL Base" },
  { id: "custom_1", name: "Custom Model 1" },
  { id: "custom_2", name: "Custom Model 2" },
  { id: "custom_3", name: "Custom Model 3" },
];

const LORAS = [
  { id: "none", name: "No LoRA" },
  { id: "lora_1", name: "LoRA 1" },
  { id: "lora_2", name: "LoRA 2" },
  { id: "lora_3", name: "LoRA 3" },
  { id: "lora_4", name: "LoRA 4" },
  { id: "lora_5", name: "LoRA 5" },
];

app.use(cors());
app.use(express.json({ limit: "30mb" }));

app.get("/health", (_request, response) => {
  response.json({ ok: true });
});

app.get("/api/options", (_request, response) => {
  response.json({ models: MODELS, loras: LORAS });
});

app.post("/api/generate", async (request, response) => {
  try {
    ensureRunPodConfig();
    const input = normalizeInput(request.body);
    const result = runpodMode === "sync" ? await runSync(input) : await runAsync(input);
    response.json(result);
  } catch (error) {
    const status = error.status || 500;
    response.status(status).json({ error: error.message || "Generation failed." });
  }
});

function ensureRunPodConfig() {
  if (!endpointId || !apiKey) {
    const error = new Error("RUNPOD_ENDPOINT_ID and RUNPOD_API_KEY must be configured on the proxy.");
    error.status = 500;
    throw error;
  }
}

function normalizeInput(body) {
  const denoise = clamp(Number(body.denoise ?? 0.35), 0.05, 1);
  const loraStrength = clamp(Number(body.lora_strength ?? 0.8), 0, 2);
  const numImages = clampInt(Number(body.num_images ?? 1), 1, 4);
  const scale = [1, 1.25, 1.5, 2].includes(Number(body.scale)) ? Number(body.scale) : 1;
  const quality = ["fast", "balanced", "high", "maximum"].includes(body.quality) ? body.quality : "balanced";

  if (!body.image_base64 || typeof body.image_base64 !== "string") {
    const error = new Error("image_base64 is required.");
    error.status = 400;
    throw error;
  }

  return {
    image_base64: body.image_base64,
    model_id: body.model_id || "sdxl_base",
    lora_id: body.lora_id || "none",
    denoise,
    lora_strength: loraStrength,
    quality,
    scale,
    num_images: numImages,
  };
}

async function runSync(input) {
  const payload = await runpodFetch("runsync", { input });
  return unwrapRunPodOutput(payload);
}

async function runAsync(input) {
  const started = await runpodFetch("run", { input });
  const jobId = started.id;

  if (!jobId) {
    throw new Error("RunPod did not return a job id.");
  }

  const deadline = Date.now() + pollTimeoutMs;
  while (Date.now() < deadline) {
    await sleep(pollIntervalMs);
    const status = await runpodFetch(`status/${jobId}`, null, "GET");

    if (status.status === "COMPLETED") {
      return unwrapRunPodOutput(status);
    }

    if (["FAILED", "CANCELLED", "TIMED_OUT"].includes(status.status)) {
      throw new Error(status.error || `RunPod job ${status.status.toLowerCase()}.`);
    }
  }

  throw new Error("RunPod job timed out while polling.");
}

async function runpodFetch(path, body, method = "POST") {
  const fetchResponse = await fetch(`${apiBase}/${endpointId}/${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const data = await fetchResponse.json().catch(() => ({}));
  if (!fetchResponse.ok) {
    throw new Error(data.error || data.message || `RunPod request failed with ${fetchResponse.status}.`);
  }

  return data;
}

function unwrapRunPodOutput(payload) {
  if (payload.output) return payload.output;
  if (payload.images) return payload;
  throw new Error(payload.error || "RunPod response did not include output images.");
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function clampInt(value, min, max) {
  return Math.trunc(clamp(Number.isFinite(value) ? value : min, min, max));
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

app.listen(port, () => {
  console.log(`Proxy listening on http://localhost:${port}`);
});

