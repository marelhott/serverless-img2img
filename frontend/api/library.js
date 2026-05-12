import { fetchBackendJson, rewriteLibraryItems } from "./_shared.js";

export default async function handler(_req, res) {
  try {
    const { response, payload } = await fetchBackendJson("/api/library");
    const items = rewriteLibraryItems(payload.items || []);
    res.status(response.status).json({ ...payload, items });
  } catch (error) {
    res.status(503).json({ detail: error.message || "Library unavailable." });
  }
}
