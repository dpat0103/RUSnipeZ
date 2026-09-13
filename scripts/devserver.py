"""Local dev server: serves web/ and mirrors the Cloudflare Worker's /api routes.

The deployed site talks to the Worker in worker/. This reproduces the same
contract locally so the frontend can be developed without wrangler or a
Cloudflare account.

    python scripts/devserver.py  ->  http://localhost:8788
"""

from __future__ import annotations

import argparse
import gzip
import json
import re
import urllib.error
import urllib.request
from functools import lru_cache
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from time import monotonic
from urllib.parse import parse_qs, urlparse

UPSTREAM = "https://classes.rutgers.edu/soc/api"
CACHE_SECONDS = 30
CAMPUSES = {"NB", "NK", "CM"}
TERM_PATTERN = re.compile(r"^[0179]\d{4}$")
ROUTES = {"/api/open": "openSections.json", "/api/courses": "courses.json"}

WEB_ROOT = Path(__file__).resolve().parent.parent / "web"
_cache: dict[str, tuple[float, bytes]] = {}


def fetch_upstream(file: str, term: str, campus: str) -> bytes:
    params = f"year={term[1:]}&term={term[0]}&campus={campus}"
    if file == "courses.json":
        params += "&subject=198"
    url = f"{UPSTREAM}/{file}?{params}"
    request = urllib.request.Request(
        url, headers={"Accept": "application/json", "User-Agent": "ru-snipez-dev/2.0"}
    )
    with urllib.request.urlopen(request, timeout=30) as response:
        raw = response.read()
        if response.headers.get("Content-Encoding") == "gzip":
            raw = gzip.decompress(raw)
        return raw


class Handler(SimpleHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def __init__(self, *args, **kwargs) -> None:
        super().__init__(*args, directory=str(WEB_ROOT), **kwargs)

    def log_message(self, fmt: str, *args) -> None:
        if "/api/" in (args[0] if args else ""):
            super().log_message(fmt, *args)

    def _send(self, status: int, body: bytes, content_type: str, cache: str) -> None:
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", cache)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(body)

    def _problem(self, status: int, detail: str) -> None:
        body = json.dumps({"error": detail}).encode()
        self._send(status, body, "application/json; charset=utf-8", "no-store")

    def end_headers(self) -> None:
        # Never cache static assets in development — otherwise an edited
        # stylesheet keeps serving from the browser cache while you debug.
        if "/api/" not in self.path:
            self.send_header("Cache-Control", "no-store, must-revalidate")
        super().end_headers()

    def do_GET(self) -> None:  # noqa: N802
        parsed = urlparse(self.path)
        file = ROUTES.get(parsed.path)
        if file is None:
            return super().do_GET()

        query = parse_qs(parsed.query)
        term = (query.get("term") or [""])[0]
        campus = (query.get("campus") or ["NB"])[0].upper()

        if not TERM_PATTERN.match(term):
            return self._problem(400, "term must be a 5-digit code such as 92026.")
        if campus not in CAMPUSES:
            return self._problem(400, f"campus must be one of {', '.join(sorted(CAMPUSES))}.")

        key = f"{parsed.path}:{term}:{campus}"
        hit = _cache.get(key)
        if hit and monotonic() - hit[0] < CACHE_SECONDS:
            return self._send(
                200, hit[1], "application/json; charset=utf-8", f"public, max-age={CACHE_SECONDS}"
            )

        try:
            body = fetch_upstream(file, term, campus)
        except (urllib.error.URLError, TimeoutError) as e:
            return self._problem(502, f"Upstream unreachable: {e}")

        _cache[key] = (monotonic(), body)
        self._send(
            200, body, "application/json; charset=utf-8", f"public, max-age={CACHE_SECONDS}"
        )


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--port", type=int, default=8788)
    args = parser.parse_args()

    server = ThreadingHTTPServer(("127.0.0.1", args.port), Handler)
    print(f"RU SnipeZ dev server -> http://localhost:{args.port}")
    print(f"  serving  {WEB_ROOT}")
    print(f"  proxying {', '.join(ROUTES)} -> {UPSTREAM}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nstopped")


if __name__ == "__main__":
    main()
