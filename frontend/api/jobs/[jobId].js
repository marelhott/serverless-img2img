import { proxyJson } from "../_shared.js";

export default async function handler(req, res) {
  const { jobId } = req.query;
  return proxyJson(req, res, `/api/jobs/${jobId}`);
}
