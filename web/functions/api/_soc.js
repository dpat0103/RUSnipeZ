/**
 * Shared logic for the /api routes, deployed as Cloudflare Pages Functions.
 *
 * Running these on the same origin as the site means the browser never makes a
 * cross-origin request at all, so CORS stops being a concern. The standalone
 * Worker in /worker does the same job for deployments that host the frontend
 * elsewhere.
 */

const UPSTREAM = "https://classes.rutgers.edu/soc/api";

// Matches upstream's own Cache-Control: max-age=30.
export const CACHE_SECONDS = 30;

const CAMPUSES = new Set(["NB", "NK", "CM"]);
// Rutgers season codes: 0 winter, 1 spring, 7 summer, 9 fall.
const TERM_PATTERN = /^[0179]\d{4}$/;

function json(body, status, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      ...extraHeaders,
    },
  });
}

export async function proxy(request, upstreamFile) {
  const url = new URL(request.url);
  const term = url.searchParams.get("term") ?? "";
  const campus = (url.searchParams.get("campus") ?? "NB").toUpperCase();

  if (!TERM_PATTERN.test(term)) {
    return json({ error: "term must be a 5-digit code such as 92026 (Fall 2026)." }, 400);
  }
  if (!CAMPUSES.has(campus)) {
    return json({ error: `campus must be one of ${[...CAMPUSES].join(", ")}.` }, 400);
  }

  // Build the upstream URL ourselves rather than forwarding the caller's
  // parameters — nothing a client sends reaches Rutgers unvalidated.
  const upstream = new URL(`${UPSTREAM}/${upstreamFile}`);
  upstream.searchParams.set("year", term.slice(1));
  upstream.searchParams.set("term", term.slice(0, 1));
  upstream.searchParams.set("campus", campus);
  if (upstreamFile === "courses.json") {
    // Required by the endpoint, ignored by it: any value returns the full
    // campus catalogue.
    upstream.searchParams.set("subject", "198");
  }

  let response;
  try {
    response = await fetch(upstream.toString(), {
      headers: { Accept: "application/json", "User-Agent": "ru-snipez/2.0" },
      // One origin request serves every visitor inside the window, however
      // many are watching.
      cf: { cacheTtl: CACHE_SECONDS, cacheEverything: true },
    });
  } catch (err) {
    return json({ error: `Upstream unreachable: ${err.message}` }, 502);
  }

  if (!response.ok) {
    return json({ error: `Upstream returned HTTP ${response.status}.` }, 502);
  }

  return new Response(response.body, {
    status: 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": `public, max-age=${CACHE_SECONDS}`,
      "Access-Control-Allow-Origin": "*",
    },
  });
}
