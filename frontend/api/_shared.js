function getBackendBase() {
  const value = process.env.INFERENCE_API_URL || "";
  return value.replace(/\/+$/, "");
}

export function ensureBackend(res) {
  const backend = getBackendBase();
  if (!backend) {
    res.status(503).json({ detail: "INFERENCE_API_URL is not configured." });
    return null;
  }
  return backend;
}

export async function proxyJson(req, res, path, init = {}) {
  const backend = ensureBackend(res);
  if (!backend) return;

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

  res.status(response.status).json(payload);
}
