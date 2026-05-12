import { fetchBackendJson, rewriteLibraryItems } from "./_shared.js";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ detail: "Method not allowed." });
    return;
  }

  try {
    const { response, payload } = await fetchBackendJson("/api/generate", {
      method: "POST",
      body: JSON.stringify(req.body || {}),
    });

    if (payload?.library_items) {
      payload.library_items = rewriteLibraryItems(payload.library_items);
    }

    res.status(response.status).json(payload);
  } catch (error) {
    res.status(503).json({ detail: error.message || "Generate unavailable." });
  }
}
