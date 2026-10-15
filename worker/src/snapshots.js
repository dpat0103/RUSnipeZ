import { snapshotKey, SNAPSHOT_CACHE } from "../../lib/snapshot-contract.js";

// Visitor reads never initialize an object, query SQL, or contact Rutgers.
export async function readSnapshot(request, env, ctx) {
  const url = new URL(request.url);
  const term = url.searchParams.get("term") ?? "";
  const campus = (url.searchParams.get("campus") ?? "NB").toUpperCase();
  const fail = (status, error) => Response.json({ error }, {
    status, headers: { "Cache-Control": "no-store" },
  });
  if (!/^[0179]\d{4}$/.test(term) || !["NB", "NK", "CM"].includes(campus)) {
    return fail(400, "Invalid term or campus");
  }
  if (!(env.SNAPSHOT_TERMS ?? env.HISTORY_TERMS ?? "92026").split(",").map((s) => s.trim()).includes(term)) {
    return fail(404, "This term is not being collected");
  }
  if (!env.SNAPSHOTS) return fail(503, "Snapshot storage is not configured");
  const key = new Request(`${url.origin}/api/snapshot?term=${term}`);
  const cache = caches.default;
  let response = await cache.match(key);
  if (response) return response;
  try {
    const object = await env.SNAPSHOTS.get(snapshotKey(term));
    if (!object) return fail(503, "The collector has not published its first snapshot");
    response = new Response(object.body, { headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": SNAPSHOT_CACHE,
      ETag: object.httpEtag,
    } });
    ctx.waitUntil(cache.put(key, response.clone()));
    return response;
  } catch {
    return fail(503, "Snapshot storage is temporarily unavailable");
  }
}
