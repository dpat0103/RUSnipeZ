import { SNAPSHOT_CACHE } from "./snapshot-contract.js";

export async function snapshotProxy(request, base) {
  const incoming = new URL(request.url);
  const term = incoming.searchParams.get("term") ?? "";
  const campus = (incoming.searchParams.get("campus") ?? "NB").toUpperCase();
  const fail = (status, error) => Response.json({ error }, {
    status, headers: { "Cache-Control": "no-store" },
  });
  if (!/^[0179]\d{4}$/.test(term) || !["NB", "NK", "CM"].includes(campus)) {
    return fail(400, "Invalid term or campus");
  }
  if (!base) return fail(503, "Shared snapshots are not configured");
  try {
    const url = new URL("/api/snapshot", base);
    url.search = new URLSearchParams({ term, campus });
    const response = await fetch(url, { signal: AbortSignal.timeout(5_000) });
    if (!response.ok) return fail(503, "Snapshot is not available yet");
    const headers = { "Content-Type": "application/json; charset=utf-8", "Cache-Control": SNAPSHOT_CACHE };
    const etag = response.headers.get("ETag");
    if (etag) headers.ETag = etag;
    return new Response(response.body, { headers });
  } catch {
    return fail(503, "Shared snapshots are temporarily unavailable");
  }
}
