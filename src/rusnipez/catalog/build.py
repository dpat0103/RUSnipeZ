"""Build the static course catalogue from the Schedule of Classes API.

This replaces V1's Selenium pipeline entirely. That version launched a headless
Chrome against each of fifteen school pages, slept ten seconds per page, saved
the rendered HTML, parsed it with BeautifulSoup and appended rows to a CSV —
to recover data the page itself had fetched as JSON. One request now does it.

Usage::

    python -m rusnipez.catalog.build --term 92026 --campus NB
"""

from __future__ import annotations

import argparse
import asyncio
import json
import logging
import sys
from collections import Counter
from datetime import UTC, datetime
from pathlib import Path

from rusnipez.soc.client import SocClient, SocError
from rusnipez.soc.normalize import normalize_catalog
from rusnipez.soc.term import Term

log = logging.getLogger("rusnipez.catalog")

DEFAULT_OUT_DIR = Path("data")


def build_payload(courses: list[dict], term: Term, campus: str) -> dict:
    """Wrap the normalized courses with metadata the frontend can display."""
    sections = [s for c in courses for s in c["sections"]]
    schools = Counter(c["school"] for c in courses if c["school"])
    core_codes = Counter(code for c in courses for code in c["core"])

    return {
        "meta": {
            "term": term.code,
            "termName": str(term),
            "campus": campus,
            "generated": datetime.now(UTC).isoformat(timespec="seconds"),
            "source": "classes.rutgers.edu/soc/api/courses.json",
            "counts": {
                "courses": len(courses),
                "sections": len(sections),
                "schools": len(schools),
                "crossListed": sum(1 for s in sections if s["crossListed"]),
                "requiresSPN": sum(1 for s in sections if s["spn"]),
            },
            "coreCodes": dict(sorted(core_codes.items())),
        },
        "courses": courses,
    }


async def build(term: Term, campus: str, out_dir: Path, *, pretty: bool = False) -> Path:
    async with SocClient(campus=campus) as client:
        log.info("fetching catalogue for %s (%s)", term, campus)
        raw = await client.courses(term)
        log.info("received %d raw course records", len(raw))

    courses = normalize_catalog(raw)
    payload = build_payload(courses, term, campus)

    out_dir.mkdir(parents=True, exist_ok=True)
    out_path = out_dir / f"catalog-{term.code}-{campus}.json"

    # Write to a temp file and replace, so a reader never sees a partial file.
    # V1 truncated its CSV in place every five seconds, which is how a reader
    # could catch a half-written row.
    tmp_path = out_path.with_suffix(".json.tmp")
    with tmp_path.open("w", encoding="utf-8") as f:
        json.dump(payload, f, indent=2 if pretty else None, separators=None if pretty else (",", ":"))
    tmp_path.replace(out_path)

    counts = payload["meta"]["counts"]
    size_kb = out_path.stat().st_size / 1024
    log.info(
        "wrote %s — %d courses, %d sections, %.0f KB",
        out_path,
        counts["courses"],
        counts["sections"],
        size_kb,
    )
    return out_path


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--term", default="92026", help="WebReg term code, e.g. 92026 (Fall 2026)")
    parser.add_argument("--campus", default="NB", help="Campus code: NB, NK or CM")
    parser.add_argument("--out", type=Path, default=DEFAULT_OUT_DIR, help="output directory")
    parser.add_argument("--pretty", action="store_true", help="indent the JSON (much larger)")
    parser.add_argument("-v", "--verbose", action="store_true")
    args = parser.parse_args(argv)

    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO,
        format="%(asctime)s %(levelname)-5s %(message)s",
        datefmt="%H:%M:%S",
    )

    try:
        term = Term.parse(args.term)
    except ValueError as e:
        parser.error(str(e))

    try:
        asyncio.run(build(term, args.campus, args.out, pretty=args.pretty))
    except SocError as e:
        log.error("catalogue build failed: %s", e)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
