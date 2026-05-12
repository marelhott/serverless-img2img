import { proxyJson } from "./_shared.js";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ detail: "Method not allowed." });
    return;
  }

  return proxyJson(req, res, "/api/generate", {
    method: "POST",
    body: JSON.stringify(req.body || {}),
  });
}
