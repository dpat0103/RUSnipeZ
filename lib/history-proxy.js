// Read a versioned daily observation from the public data branch. No database,
// Cloudflare account, paid storage, or token is required by this read endpoint.
export async function historyProxy(request, repository = "dpat0103/RUSnipeZ") {
  const params = new URL(request.url).searchParams;
  const term = params.get("term") ?? "";
  const campus = (params.get("campus") ?? "NB").toUpperCase();
  const fail = (status, error) => Response.json({ error }, {
    status, headers: { "Cache-Control": "no-store" },
  });
  if (!/^[0179]\d{4}$/.test(term) || !["NB", "NK", "CM"].includes(campus)) {
    return fail(400, "Invalid term or campus");
  }
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) {
    return fail(503, "Invalid history repository configuration");
  }
  try {
    const url = `https://raw.githubusercontent.com/${repository}/history-data/history-${term}.json`;
    const response = await fetch(url, { signal: AbortSignal.timeout(5_000) });
    if (!response.ok) return fail(503, "Daily history is not available yet");
    const payload = await response.json();
    if (payload.schemaVersion !== 3 || payload.term !== term || payload.sampling !== "daily" ||
        !Number.isFinite(Date.parse(payload.checkedAt)) ||
        !payload.sections || typeof payload.sections !== "object" || Array.isArray(payload.sections)) {
      return fail(502, "Invalid daily history");
    }
    return Response.json(payload, { headers: {
      "Cache-Control": "public, max-age=300, s-maxage=3600, stale-while-revalidate=86400",
    } });
  } catch {
    return fail(503, "Daily history is temporarily unavailable");
  }
}
