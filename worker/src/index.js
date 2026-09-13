/**
 * Edge proxy for the Rutgers Schedule of Classes API.
 *
 * Exists for two reasons:
 *
 * 1. The upstream endpoints send no `Access-Control-Allow-Origin` header, so a
 *    browser cannot call them from a page. This adds one.
 * 2. Upstream advertises `Cache-Control: max-age=30`. Caching at the edge means
 *    one origin request serves every visitor in that window, however many are
 *    watching, instead of one request per visitor.
 *
 * It is deliberately NOT a general proxy: the path, term and campus are all
 * validated against allowlists so this cannot be pointed at arbitrary hosts.
 */

const UPSTREAM = "https://classes.rutgers.edu/soc/api";

// Matches upstream's own max-age. Polling faster buys nothing.
const CACHE_SECONDS = 30;

const CAMPUSES = new Set(["NB", "NK", "CM"]);
// Rutgers season codes: 0 winter, 1 spring, 7 summer, 9 fall.
const TERM_PATTERN = /^[0179]\d{4}$/;

const ROUTES = {
  "/api/open": "openSections.json",
  "/api/courses": "courses.json",
};

function corsHeaders(request, env) {
  const allowed = (env.ALLOWED_ORIGINS ?? "*").split(",").map((s) => s.trim());
  const origin = request.headers.get("Origin");
  const allowOrigin =
    allowed.includes("*") || (origin && allowed.includes(origin)) ? origin ?? "*" : allowed[0];

  return {
    "Access-Control-Allow-Origin": allowOrigin,
    "Vary": "Origin",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Max-Age": "86400",
  };
}

function problem(status, detail, request, env) {
  return new Response(JSON.stringify({ error: detail }), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      ...corsHeaders(request, env),
    },
  });
}

export default {
  async fetch(request, env, ctx) {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders(request, env) });
    }
    if (request.method !== "GET") {
      return problem(405, "Only GET is supported.", request, env);
    }

    const url = new URL(request.url);
    const upstreamFile = ROUTES[url.pathname];
    if (!upstreamFile) {
      return problem(404, `Unknown path. Try ${Object.keys(ROUTES).join(" or ")}.`, request, env);
    }

    const term = url.searchParams.get("term") ?? "";
    const campus = (url.searchParams.get("campus") ?? "NB").toUpperCase();

    if (!TERM_PATTERN.test(term)) {
      return problem(400, "term must be a 5-digit code such as 92026 (Fall 2026).", request, env);
    }
    if (!CAMPUSES.has(campus)) {
      return problem(400, `campus must be one of ${[...CAMPUSES].join(", ")}.`, request, env);
    }

    // Rebuild upstream params ourselves rather than forwarding the caller's —
    // nothing the client sends reaches Rutgers unvalidated.
    const upstreamUrl = new URL(`${UPSTREAM}/${upstreamFile}`);
    upstreamUrl.searchParams.set("year", term.slice(1));
    upstreamUrl.searchParams.set("term", term.slice(0, 1));
    upstreamUrl.searchParams.set("campus", campus);
    if (upstreamFile === "courses.json") {
      // Required by the endpoint but ignored by it; any value returns the
      // full campus catalogue.
      upstreamUrl.searchParams.set("subject", "198");
    }

    // Normalized cache key, so ?campus=nb and ?campus=NB share one entry.
    const cacheKey = new Request(
      `${url.origin}${url.pathname}?term=${term}&campus=${campus}`,
      { method: "GET" }
    );
    const cache = caches.default;

    const cached = await cache.match(cacheKey);
    if (cached) {
      const hit = new Response(cached.body, cached);
      hit.headers.set("X-Cache", "HIT");
      return hit;
    }

    let upstream;
    try {
      upstream = await fetch(upstreamUrl.toString(), {
        headers: { Accept: "application/json", "User-Agent": "ru-snipez-worker/2.0" },
        cf: { cacheTtl: CACHE_SECONDS, cacheEverything: true },
      });
    } catch (err) {
      return problem(502, `Upstream unreachable: ${err.message}`, request, env);
    }

    if (!upstream.ok) {
      return problem(502, `Upstream returned HTTP ${upstream.status}.`, request, env);
    }

    const response = new Response(upstream.body, {
      status: 200,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": `public, max-age=${CACHE_SECONDS}`,
        "X-Cache": "MISS",
        "X-Upstream-Age": upstream.headers.get("Age") ?? "0",
        ...corsHeaders(request, env),
      },
    });

    // Populate the cache without making the client wait for it.
    ctx.waitUntil(cache.put(cacheKey, response.clone()));
    return response;
  },
};
