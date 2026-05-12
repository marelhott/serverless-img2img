import { proxyBinary } from "../_shared.js";

export default async function handler(req, res) {
  const path = Array.isArray(req.query.path) ? req.query.path.join("/") : req.query.path;
  return proxyBinary(req, res, `/library/${path}`);
}
