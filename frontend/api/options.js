import { proxyJson } from "./_shared.js";

export default async function handler(_req, res) {
  return proxyJson(_req, res, "/api/options");
}
