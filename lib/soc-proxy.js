/**
 * Shared proxy logic for the Rutgers Schedule of Classes API.
 *
 * Exists because the university endpoints send no cross-origin headers, so a
 * browser cannot call them from a page, and because caching the response at
 * the edge means one upstream request serves every visitor in the window
 * rather than one request per visitor.
 *
 * Written against the web-standard Request and Response, so the same function
 * backs both the Vercel edge adapter in /api and the Cloudflare Worker in
 * /worker without modification.
 */

const UPSTREAM = "https://classes.rutgers.edu/soc/api";

// Matches the Cache-Control the upstream endpoints declare.
export const CACHE_SECONDS = 30;

export const ROUTES = {
  open: "openSections.json",
  courses: "courses.json",
};

const CAMPUSES = new Set(["NB", "NK", "CM"]);
// Rutgers season codes: 0 winter, 1 spring, 7 summer, 9 fall.
const TERM_PATTERN = /^[0179]\d{4}$/;

function json(body, status, extra = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "Access-Control-Allow-Origin": "*",
      ...extra,
    },
  });
}

/**
 * @param {Request} request  incoming request, used only for its query string
 * @param {string} route     key of ROUTES
 * @param {object} [options] fetchOptions are merged into the upstream fetch,
 *                           which is how Cloudflare passes its `cf` cache hints
 */
export async function proxy(request, route, { fetchOptions = {} } = {}) {
  const upstreamFile = ROUTES[route];
  if (!upstreamFile) return json({ error: "Unknown route." }, 404);

  const url = new URL(request.url);
  const term = url.searchParams.get("term") ?? "";
  const campus = (url.searchParams.get("campus") ?? "NB").toUpperCase();

  if (!TERM_PATTERN.test(term)) {
    return json({ error: "term must be a 5-digit code such as 92026 (Fall 2026)." }, 400);
  }
  if (!CAMPUSES.has(campus)) {
    return json({ error: `campus must be one of ${[...CAMPUSES].join(", ")}.` }, 400);
  }

  // The upstream URL is rebuilt here rather than forwarded, so nothing a
  // caller sends reaches Rutgers unvalidated.
  const upstream = new URL(`${UPSTREAM}/${upstreamFile}`);
  upstream.searchParams.set("year", term.slice(1));
  upstream.searchParams.set("term", term.slice(0, 1));
  upstream.searchParams.set("campus", campus);
  if (upstreamFile === "courses.json") {
    // Required by the endpoint and ignored by it: any value returns the full
    // campus catalogue.
    upstream.searchParams.set("subject", "198");
  }

  let response;
  try {
    response = await fetch(upstream.toString(), {
      headers: { Accept: "application/json", "User-Agent": "ru-snipez/2.0" },
      ...fetchOptions,
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
      "Cache-Control": `public, max-age=${CACHE_SECONDS}, s-maxage=${CACHE_SECONDS}`,
      "Access-Control-Allow-Origin": "*",
    },
  });
}

export function preflight() {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Max-Age": "86400",
    },
  });
}
