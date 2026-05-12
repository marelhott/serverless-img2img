const DEFAULT_PORT = process.env.RUNPOD_PROXY_PORT || "8000";
const CACHE_TTL_MS = 10_000;

export async function fetchBackendJson(path, init = {}) {
  const backend = await resolveBackendBase();
  const response = await fetch(`${backend}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  });

  const text = await response.text();
  let payload;
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    payload = { detail: text || "Invalid upstream response." };
  }

  return { response, payload };
}

export async function proxyJson(req, res, path, init = {}) {
  try {
    const { response, payload } = await fetchBackendJson(path, init);
    res.status(response.status).json(payload);
  } catch (error) {
    res.status(503).json({ detail: error.message || "Backend unavailable." });
  }
}

export async function proxyBinary(req, res, path) {
  try {
    const backend = await resolveBackendBase();
    const response = await fetch(`${backend}${path}`);
    if (!response.ok) {
      res.status(response.status).send(await response.text());
      return;
    }

    const arrayBuffer = await response.arrayBuffer();
    const contentType = response.headers.get("content-type") || "application/octet-stream";
    const cacheControl = response.headers.get("cache-control") || "public, max-age=60";
    res.setHeader("Content-Type", contentType);
    res.setHeader("Cache-Control", cacheControl);
    res.status(200).send(Buffer.from(arrayBuffer));
  } catch (error) {
    res.status(503).json({ detail: error.message || "Asset proxy unavailable." });
  }
}

export function rewriteLibraryItems(items = []) {
  return items.map((item) => {
    if (!item?.url?.startsWith("/library/")) return item;
    const filename = item.url.replace(/^\/library\//, "");
    return {
      ...item,
      url: `/api/library-assets/${filename}`,
    };
  });
}

async function resolveBackendBase() {
  const direct = (process.env.INFERENCE_API_URL || "").replace(/\/+$/, "");
  if (direct) return direct;

  const apiKey = process.env.RUNPOD_API_KEY;
  if (!apiKey) {
    throw new Error("RUNPOD_API_KEY or INFERENCE_API_URL is not configured.");
  }

  const cached = globalThis.__runpodBackendCache;
  if (cached && cached.expiresAt > Date.now()) {
    return cached.url;
  }

  const response = await fetch("https://rest.runpod.io/v1/pods", {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!response.ok) {
    throw new Error(`RunPod API returned ${response.status}.`);
  }

  const pods = await response.json();
  const pod = pickPod(pods);
  if (!pod) {
    throw new Error("No matching running RunPod pod found.");
  }

  const url = `https://${pod.id}-${DEFAULT_PORT}.proxy.runpod.net`;
  globalThis.__runpodBackendCache = {
    url,
    expiresAt: Date.now() + CACHE_TTL_MS,
  };
  return url;
}

function pickPod(pods) {
  const podId = process.env.RUNPOD_POD_ID || "";
  const podName = process.env.RUNPOD_POD_NAME || "";
  const templateId = process.env.RUNPOD_TEMPLATE_ID || "";

  const runningPods = (pods || []).filter((pod) => pod?.desiredStatus === "RUNNING");

  const exactId = podId ? runningPods.find((pod) => pod.id === podId) : null;
  if (exactId) return exactId;

  const exactName = podName ? runningPods.find((pod) => pod.name === podName) : null;
  if (exactName) return exactName;

  const byTemplate = templateId
    ? runningPods.filter((pod) => pod.templateId === templateId).sort(sortPodsByFreshness)[0]
    : null;
  if (byTemplate) return byTemplate;

  return runningPods.sort(sortPodsByFreshness)[0] || null;
}

function sortPodsByFreshness(a, b) {
  const aTime = Date.parse(a?.lastStartedAt || a?.createdAt || 0) || 0;
  const bTime = Date.parse(b?.lastStartedAt || b?.createdAt || 0) || 0;
  return bTime - aTime;
}
