"""Async client for the Rutgers Schedule of Classes JSON API.

Two endpoints matter:

``openSections.json``
    A flat array of currently-open index strings. Small (~26KB) and cheap —
    this is the polling endpoint.

``courses.json``
    The full catalogue with per-section metadata (~930KB). The ``subject``
    parameter is accepted but ignored: one request returns the entire campus
    catalogue. This replaces the Selenium scraper that V1 used.

Both send ``Cache-Control: max-age=30``, so polling faster than that is not
promised fresher data. They send an ``ETag`` but ignore ``If-None-Match``,
so conditional requests buy nothing.

Neither endpoint sends CORS headers — a browser cannot call them from a page.
See ``worker/`` for the proxy that fronts them.
"""

from __future__ import annotations

import logging
from types import TracebackType
from typing import Any, Self

import httpx

from rusnipez.soc.term import Term

log = logging.getLogger(__name__)

BASE_URL = "https://classes.rutgers.edu/soc/api"
USER_AGENT = "ru-snipez/2.0 (+https://github.com/dpat0103/ru-snipez)"

# Upstream advertises max-age=30; there is no point polling faster than this.
MIN_POLL_SECONDS = 30.0


class SocError(RuntimeError):
    """The Schedule of Classes API returned something unusable."""


class SocClient:
    """Keep-alive HTTP client for the Schedule of Classes API.

    V1 opened a fresh TLS connection on every poll via ``requests.get``, paying
    a handshake each time. Reusing one client keeps the connection warm.
    """

    def __init__(
        self,
        campus: str = "NB",
        *,
        timeout: float = 20.0,
        client: httpx.AsyncClient | None = None,
    ) -> None:
        self.campus = campus
        self._owns_client = client is None
        self._client = client or httpx.AsyncClient(
            base_url=BASE_URL,
            timeout=httpx.Timeout(timeout, connect=5.0),
            headers={"User-Agent": USER_AGENT, "Accept": "application/json"},
            limits=httpx.Limits(max_keepalive_connections=4, keepalive_expiry=120.0),
            follow_redirects=True,
        )

    async def __aenter__(self) -> Self:
        return self

    async def __aexit__(
        self,
        exc_type: type[BaseException] | None,
        exc: BaseException | None,
        tb: TracebackType | None,
    ) -> None:
        await self.aclose()

    async def aclose(self) -> None:
        if self._owns_client:
            await self._client.aclose()

    async def _get_json(self, path: str, params: dict[str, str]) -> Any:
        try:
            response = await self._client.get(path, params=params)
            response.raise_for_status()
            return response.json()
        except httpx.HTTPStatusError as e:
            raise SocError(f"{path} returned HTTP {e.response.status_code}") from e
        except httpx.HTTPError as e:
            raise SocError(f"{path} request failed: {e}") from e
        except ValueError as e:
            raise SocError(f"{path} returned malformed JSON") from e

    async def open_sections(self, term: Term) -> set[str]:
        """Return the set of index numbers currently marked open."""
        data = await self._get_json("/openSections.json", term.soc_params(self.campus))
        if not isinstance(data, list):
            raise SocError(f"openSections.json returned {type(data).__name__}, expected list")
        return {str(index) for index in data}

    async def courses(self, term: Term) -> list[dict[str, Any]]:
        """Return the full catalogue for the term.

        ``subject`` is required by the endpoint but ignored by it; any value
        returns the whole campus catalogue.
        """
        params = term.soc_params(self.campus) | {"subject": "198"}
        data = await self._get_json("/courses.json", params)
        if not isinstance(data, list):
            raise SocError(f"courses.json returned {type(data).__name__}, expected list")
        if not data:
            raise SocError(f"courses.json returned an empty catalogue for {term}")
        return data
