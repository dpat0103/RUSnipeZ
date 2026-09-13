import { proxy, preflight } from "../lib/soc-proxy.js";

export const config = { runtime: "edge" };

export default async function handler(request) {
  if (request.method === "OPTIONS") return preflight();
  if (request.method !== "GET") {
    return new Response(JSON.stringify({ error: "Only GET is supported." }), {
      status: 405,
      headers: { "Content-Type": "application/json" },
    });
  }
  return proxy(request, "courses");
}
