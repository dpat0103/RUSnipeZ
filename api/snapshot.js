import { snapshotProxy } from "../lib/snapshot-proxy.js";
import { preflight } from "../lib/soc-proxy.js";

export const config = { runtime: "edge" };

export default function handler(request) {
  if (request.method === "OPTIONS") return preflight();
  if (request.method !== "GET") return new Response(null, { status: 405 });
  return snapshotProxy(request, process.env.HISTORY_API_BASE);
}
